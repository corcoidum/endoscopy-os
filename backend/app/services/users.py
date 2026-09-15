from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.exceptions import ApiError
from app.core.security import hash_password, normalize_login_id
from app.models import (
    Permission,
    Role,
    RolePermission,
    StaffProfile,
    User,
    UserRole,
)
from app.services.auth import revoke_all_user_sessions


def _user_options() -> tuple[object, ...]:
    return (
        selectinload(User.role_assignments)
        .selectinload(UserRole.role)
        .selectinload(Role.permission_assignments)
        .selectinload(RolePermission.permission),
        selectinload(User.staff_profile),
    )


def list_users(
    db: Session,
    *,
    include_inactive: bool,
    limit: int,
    offset: int,
) -> list[User]:
    statement = (
        select(User)
        .options(*_user_options())
        .order_by(User.display_name, User.login_id_normalized)
        .limit(limit)
        .offset(offset)
    )
    if not include_inactive:
        statement = statement.where(User.is_active.is_(True))
    return list(db.scalars(statement).all())


def get_user(db: Session, user_id: UUID, *, for_update: bool = False) -> User:
    statement = (
        select(User).where(User.id == user_id).options(*_user_options())
    )
    if for_update:
        statement = statement.with_for_update()
    user = db.scalar(statement)
    if user is None:
        raise ApiError(
            status_code=404,
            code="USER_NOT_FOUND",
            message="사용자 계정을 찾을 수 없습니다.",
        )
    return user


def list_roles(db: Session, *, include_inactive: bool) -> list[Role]:
    statement = (
        select(Role)
        .options(
            selectinload(Role.permission_assignments).selectinload(
                RolePermission.permission
            )
        )
        .order_by(Role.code)
    )
    if not include_inactive:
        statement = statement.where(Role.is_active.is_(True))
    return list(db.scalars(statement).all())


def list_permissions(db: Session) -> list[Permission]:
    return list(db.scalars(select(Permission).order_by(Permission.code)).all())


def _load_active_roles(db: Session, role_ids: list[UUID]) -> list[Role]:
    roles = list(
        db.scalars(
            select(Role).where(Role.id.in_(role_ids), Role.is_active.is_(True))
        ).all()
    )
    if len(roles) != len(role_ids):
        raise ApiError(
            status_code=422,
            code="ROLE_INVALID",
            message="존재하지 않거나 비활성화된 역할이 포함되어 있습니다.",
        )
    return roles


def _load_available_staff_profile(
    db: Session, staff_profile_id: UUID | None
) -> StaffProfile | None:
    if staff_profile_id is None:
        return None
    profile = db.scalar(
        select(StaffProfile).where(
            StaffProfile.id == staff_profile_id,
            StaffProfile.is_active.is_(True),
        )
    )
    if profile is None:
        raise ApiError(
            status_code=422,
            code="STAFF_PROFILE_INVALID",
            message="사용할 수 없는 직원 Profile입니다.",
        )
    linked_user_id = db.scalar(
        select(User.id).where(User.staff_profile_id == staff_profile_id)
    )
    if linked_user_id is not None:
        raise ApiError(
            status_code=409,
            code="STAFF_PROFILE_ALREADY_LINKED",
            message="이미 다른 계정에 연결된 직원 Profile입니다.",
        )
    return profile


def create_user(
    db: Session,
    *,
    login_id: str,
    password: str,
    display_name: str,
    staff_profile_id: UUID | None,
    role_ids: list[UUID],
) -> User:
    normalized_login_id = normalize_login_id(login_id)
    existing_id = db.scalar(
        select(User.id).where(User.login_id_normalized == normalized_login_id)
    )
    if existing_id is not None:
        raise ApiError(
            status_code=409,
            code="LOGIN_ID_DUPLICATE",
            message="이미 사용 중인 로그인 ID입니다.",
        )

    roles = _load_active_roles(db, role_ids)
    staff_profile = _load_available_staff_profile(db, staff_profile_id)
    now = datetime.now(UTC)
    user = User(
        login_id_normalized=normalized_login_id,
        password_hash=hash_password(password),
        display_name=display_name.strip(),
        staff_profile=staff_profile,
        is_active=True,
        must_change_password=True,
        password_changed_at=now,
    )
    user.role_assignments = [UserRole(role=role) for role in roles]
    db.add(user)
    db.flush()
    return user


def replace_user_roles(
    db: Session,
    *,
    target_user_id: UUID,
    actor_user_id: UUID,
    role_ids: list[UUID],
) -> User:
    if target_user_id == actor_user_id:
        raise ApiError(
            status_code=409,
            code="SELF_ROLE_CHANGE_NOT_ALLOWED",
            message="현재 로그인한 계정의 역할은 다른 관리자가 변경해야 합니다.",
        )
    user = get_user(db, target_user_id, for_update=True)
    roles = _load_active_roles(db, role_ids)
    user.role_assignments = [UserRole(role=role) for role in roles]
    user.row_version += 1
    revoke_all_user_sessions(
        db,
        user_id=user.id,
        reason="역할 변경으로 Session 종료",
    )
    db.flush()
    return user


def unlock_user(db: Session, *, target_user_id: UUID) -> User:
    """로그인 실패로 잠긴 계정을 관리자가 즉시 해제한다."""

    user = get_user(db, target_user_id, for_update=True)
    if user.failed_login_count == 0 and user.locked_until is None:
        return user
    user.failed_login_count = 0
    user.locked_until = None
    user.row_version += 1
    db.flush()
    return user


def set_user_activation(
    db: Session,
    *,
    target_user_id: UUID,
    actor_user_id: UUID,
    is_active: bool,
) -> User:
    if target_user_id == actor_user_id and not is_active:
        raise ApiError(
            status_code=409,
            code="SELF_DEACTIVATION_NOT_ALLOWED",
            message="현재 로그인한 계정은 스스로 비활성화할 수 없습니다.",
        )
    user = get_user(db, target_user_id, for_update=True)
    if user.is_active == is_active:
        return user
    user.is_active = is_active
    user.row_version += 1
    if not is_active:
        revoke_all_user_sessions(
            db,
            user_id=user.id,
            reason="계정 비활성화로 Session 종료",
        )
    db.flush()
    return user
