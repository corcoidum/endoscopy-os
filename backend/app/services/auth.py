from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.core.config import Settings
from app.core.exceptions import ApiError
from app.core.security import (
    derive_csrf_token,
    generate_session_token,
    hash_password,
    normalize_login_id,
    sha256_token,
    verify_against_dummy_hash,
    verify_password,
)
from app.models import Role, RolePermission, User, UserRole, UserSession


def _generic_login_error() -> ApiError:
    return ApiError(
        status_code=401,
        code="AUTHENTICATION_FAILED",
        message="아이디 또는 비밀번호를 확인해 주세요.",
        headers={"WWW-Authenticate": "Session"},
    )


@dataclass(slots=True)
class AuthenticationResult:
    user: User
    session: UserSession
    session_token: str
    csrf_token: str


def as_utc(value: datetime) -> datetime:
    """SQLite drops timezone information; PostgreSQL keeps it."""

    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _user_identity_options() -> tuple[object, ...]:
    return (
        selectinload(User.role_assignments)
        .selectinload(UserRole.role)
        .selectinload(Role.permission_assignments)
        .selectinload(RolePermission.permission),
        selectinload(User.staff_profile),
    )


def _record_password_failure(
    user: User, *, settings: Settings, now: datetime
) -> bool:
    """비밀번호 확인 실패를 기록하고 이번 실패로 계정이 잠겼는지 돌려준다."""

    user.failed_login_count += 1
    user.row_version += 1
    if user.failed_login_count >= settings.max_login_failures:
        user.locked_until = now + timedelta(minutes=settings.login_lock_minutes)
        return True
    return False


def authenticate(
    db: Session,
    *,
    login_id: str,
    password: str,
    client_ip: str,
    user_agent: str | None,
    settings: Settings,
    now: datetime | None = None,
) -> AuthenticationResult:
    now = now or datetime.now(UTC)
    normalized_login_id = normalize_login_id(login_id)
    statement = (
        select(User)
        .where(User.login_id_normalized == normalized_login_id)
        .with_for_update()
        .options(*_user_identity_options())
    )
    user = db.scalar(statement)

    if user is None:
        verify_against_dummy_hash(password)
        raise _generic_login_error()

    try:
        password_is_valid = verify_password(password, user.password_hash)
    except Exception:
        password_is_valid = False

    if user.locked_until is not None and as_utc(user.locked_until) > now:
        raise _generic_login_error()

    if user.locked_until is not None and as_utc(user.locked_until) <= now:
        user.locked_until = None
        user.failed_login_count = 0

    if not password_is_valid:
        _record_password_failure(user, settings=settings, now=now)
        db.flush()
        db.commit()
        raise _generic_login_error()

    if not user.is_active:
        raise _generic_login_error()

    user.failed_login_count = 0
    user.locked_until = None
    user.last_login_at = now
    user.row_version += 1

    raw_session_token = generate_session_token()
    session_token_hash = sha256_token(
        raw_session_token, settings.session_secret_value
    )
    raw_csrf_token = derive_csrf_token(
        session_token_hash, settings.session_secret_value
    )
    absolute_expires_at = now + timedelta(hours=settings.session_absolute_hours)
    idle_expires_at = min(
        now + timedelta(minutes=settings.session_idle_minutes),
        absolute_expires_at,
    )
    user_session = UserSession(
        user=user,
        session_token_hash=session_token_hash,
        csrf_secret_hash=sha256_token(
            raw_csrf_token, settings.session_secret_value
        ),
        created_ip=client_ip,
        user_agent_summary=(user_agent or "")[:200] or None,
        created_at=now,
        last_seen_at=now,
        idle_expires_at=idle_expires_at,
        absolute_expires_at=absolute_expires_at,
    )
    db.add(user_session)
    db.flush()
    return AuthenticationResult(
        user=user,
        session=user_session,
        session_token=raw_session_token,
        csrf_token=raw_csrf_token,
    )


def load_session(
    db: Session,
    *,
    raw_session_token: str,
    settings: Settings,
) -> UserSession | None:
    statement = (
        select(UserSession)
        .where(
            UserSession.session_token_hash
            == sha256_token(
                raw_session_token, settings.session_secret_value
            )
        )
        .options(
            joinedload(UserSession.user).joinedload(User.staff_profile),
            joinedload(UserSession.user)
            .selectinload(User.role_assignments)
            .selectinload(UserRole.role)
            .selectinload(Role.permission_assignments)
            .selectinload(RolePermission.permission),
        )
    )
    return db.scalar(statement)


def session_invalid_reason(
    user_session: UserSession,
    *,
    now: datetime,
    client_ip: str,
    bind_to_ip: bool,
) -> str | None:
    if user_session.revoked_at is not None:
        return "이미 종료된 Session입니다."
    if not user_session.user.is_active:
        return "비활성화된 계정입니다."
    if as_utc(user_session.absolute_expires_at) <= now:
        return "Session 최대 사용시간이 만료되었습니다."
    if as_utc(user_session.idle_expires_at) <= now:
        return "미사용 시간이 지나 Session이 만료되었습니다."
    if bind_to_ip and str(user_session.created_ip) != client_ip:
        return "접속 위치가 변경되었습니다."
    return None


def revoke_session(
    user_session: UserSession,
    *,
    reason: str,
    now: datetime | None = None,
) -> None:
    if user_session.revoked_at is None:
        user_session.revoked_at = now or datetime.now(UTC)
        user_session.revoke_reason = reason[:100]


def touch_session(
    user_session: UserSession,
    *,
    settings: Settings,
    now: datetime | None = None,
) -> None:
    now = now or datetime.now(UTC)
    if (
        now - as_utc(user_session.last_seen_at)
        < timedelta(seconds=settings.session_touch_interval_seconds)
    ):
        return
    user_session.last_seen_at = now
    user_session.idle_expires_at = min(
        now + timedelta(minutes=settings.session_idle_minutes),
        as_utc(user_session.absolute_expires_at),
    )


def issue_csrf_token(user_session: UserSession, *, settings: Settings) -> str:
    """Session에 고정된 CSRF Token을 돌려준다.

    새 탭이 `/auth/me`를 호출해도 Token이 바뀌지 않아 기존 탭의 저장 요청이
    거부되지 않는다.
    """

    raw_csrf_token = derive_csrf_token(
        user_session.session_token_hash, settings.session_secret_value
    )
    expected_hash = sha256_token(raw_csrf_token, settings.session_secret_value)
    if user_session.csrf_secret_hash != expected_hash:
        # 이전 방식(요청마다 난수 발급)으로 만든 Session을 한 번만 전환한다.
        user_session.csrf_secret_hash = expected_hash
    return raw_csrf_token


def revoke_all_user_sessions(
    db: Session,
    *,
    user_id: object,
    reason: str,
    except_session_id: object | None = None,
    now: datetime | None = None,
) -> None:
    now = now or datetime.now(UTC)
    sessions = db.scalars(
        select(UserSession).where(
            UserSession.user_id == user_id,
            UserSession.revoked_at.is_(None),
        )
    ).all()
    for user_session in sessions:
        if except_session_id is not None and user_session.id == except_session_id:
            continue
        revoke_session(user_session, reason=reason, now=now)


def change_password(
    db: Session,
    *,
    user: User,
    current_session: UserSession,
    current_password: str,
    new_password: str,
    settings: Settings,
    now: datetime | None = None,
) -> None:
    now = now or datetime.now(UTC)
    locked_user = db.scalar(
        select(User).where(User.id == user.id).with_for_update()
    )
    current_password_invalid = ApiError(
        status_code=400,
        code="CURRENT_PASSWORD_INVALID",
        message="현재 비밀번호가 일치하지 않습니다.",
    )
    if locked_user is None:
        raise current_password_invalid
    if not verify_password(current_password, locked_user.password_hash):
        # 탈취된 Session으로 현재 비밀번호를 무차별 대입하지 못하도록 로그인 실패와
        # 같은 한도로 계정을 잠그고 모든 Session을 종료한다.
        account_locked = _record_password_failure(
            locked_user, settings=settings, now=now
        )
        if account_locked:
            revoke_all_user_sessions(
                db,
                user_id=locked_user.id,
                reason="현재 비밀번호 확인 반복 실패로 계정 잠금",
                now=now,
            )
        db.flush()
        db.commit()
        if account_locked:
            raise ApiError(
                status_code=401,
                code="ACCOUNT_LOCKED",
                message="현재 비밀번호 확인에 여러 번 실패해 계정이 잠겼습니다. 잠시 후 다시 로그인해 주세요.",
                headers={"WWW-Authenticate": "Session"},
            )
        raise current_password_invalid
    if verify_password(new_password, locked_user.password_hash):
        raise ApiError(
            status_code=422,
            code="PASSWORD_REUSE_NOT_ALLOWED",
            message="새 비밀번호는 현재 비밀번호와 달라야 합니다.",
        )
    locked_user.password_hash = hash_password(new_password)
    locked_user.password_changed_at = now
    locked_user.must_change_password = False
    locked_user.failed_login_count = 0
    locked_user.locked_until = None
    locked_user.row_version += 1
    revoke_all_user_sessions(
        db,
        user_id=locked_user.id,
        reason="비밀번호 변경으로 Session 종료",
        except_session_id=current_session.id,
        now=now,
    )
    db.flush()
