from __future__ import annotations

import hmac
from dataclasses import dataclass
from datetime import UTC, datetime
from urllib.parse import urlsplit

from fastapi import Depends, Request, Response
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.exceptions import ApiError
from app.core.network import resolve_client_ip
from app.core.security import sha256_token
from app.db.session import get_db
from app.models import User, UserSession
from app.services.auth import (
    as_utc,
    load_session,
    revoke_session,
    session_invalid_reason,
    touch_session,
)

SESSION_EXPIRES_AT_HEADER = "X-Session-Expires-At"


@dataclass(slots=True)
class Principal:
    user: User
    session: UserSession
    roles: frozenset[str]
    permissions: frozenset[str]


def _not_authenticated() -> ApiError:
    return ApiError(
        status_code=401,
        code="SESSION_REQUIRED",
        message="로그인이 필요하거나 Session이 만료되었습니다.",
        headers={"WWW-Authenticate": "Session"},
    )


def verify_request_origin(
    request: Request,
    settings: Settings = Depends(get_settings),
) -> None:
    if not settings.csrf_require_origin:
        return
    candidate_origin = request.headers.get("origin")
    if candidate_origin is None:
        referer = request.headers.get("referer")
        if referer:
            parsed = urlsplit(referer)
            candidate_origin = f"{parsed.scheme}://{parsed.netloc}"
    allowed = {origin.rstrip("/") for origin in settings.allowed_origins}
    if candidate_origin is None or candidate_origin.rstrip("/") not in allowed:
        raise ApiError(
            status_code=403,
            code="ORIGIN_NOT_ALLOWED",
            message="허용되지 않은 요청 출처입니다.",
        )


def get_current_principal(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> Principal:
    raw_token = request.cookies.get(settings.session_cookie_name)
    if not raw_token:
        raise _not_authenticated()
    user_session = load_session(
        db, raw_session_token=raw_token, settings=settings
    )
    if user_session is None:
        raise _not_authenticated()

    now = datetime.now(UTC)
    client_ip = resolve_client_ip(request, settings)
    invalid_reason = session_invalid_reason(
        user_session,
        now=now,
        client_ip=client_ip,
        bind_to_ip=settings.bind_session_to_ip,
    )
    if invalid_reason is not None:
        revoke_session(user_session, reason=invalid_reason, now=now)
        db.commit()
        raise _not_authenticated()

    touch_session(user_session, settings=settings, now=now)
    if db.is_modified(user_session):
        db.commit()
    # Frontend 자동 로그아웃 Timer가 서버에서 연장된 만료시각을 따라가도록 알린다.
    response.headers[SESSION_EXPIRES_AT_HEADER] = min(
        as_utc(user_session.idle_expires_at),
        as_utc(user_session.absolute_expires_at),
    ).isoformat()
    principal = Principal(
        user=user_session.user,
        session=user_session,
        roles=frozenset(user_session.user.active_role_codes(now)),
        permissions=frozenset(user_session.user.active_permission_codes(now)),
    )
    request.state.principal = principal
    return principal


def verify_csrf(
    request: Request,
    principal: Principal = Depends(get_current_principal),
    settings: Settings = Depends(get_settings),
) -> None:
    verify_request_origin(request, settings)
    raw_csrf_token = request.headers.get(settings.csrf_header_name)
    if not raw_csrf_token or not hmac.compare_digest(
        sha256_token(
            raw_csrf_token, settings.session_secret_value
        ),
        principal.session.csrf_secret_hash,
    ):
        raise ApiError(
            status_code=403,
            code="CSRF_TOKEN_INVALID",
            message="보안 확인값이 만료되었습니다. 화면을 새로고침해 주세요.",
        )


def require_permission(permission_code: str):
    def check_permission(
        principal: Principal = Depends(get_current_principal),
    ) -> Principal:
        if principal.user.must_change_password:
            raise ApiError(
                status_code=403,
                code="PASSWORD_CHANGE_REQUIRED",
                message="최초 로그인 Password를 변경한 후 업무를 시작해 주세요.",
            )
        if permission_code not in principal.permissions:
            raise ApiError(
                status_code=403,
                code="PERMISSION_DENIED",
                message="이 작업을 수행할 권한이 없습니다.",
            )
        return principal

    return check_permission
