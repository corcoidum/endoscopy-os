from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from app.api.dependencies import (
    Principal,
    get_current_principal,
    verify_csrf,
    verify_request_origin,
)
from app.api.presenters import present_authenticated_user
from app.core.config import Settings, get_settings
from app.core.exceptions import ApiError
from app.core.network import resolve_client_ip
from app.core.rate_limit import LoginFailureThrottle
from app.db.session import get_db
from app.schemas.common import ErrorResponse, MessageResponse
from app.schemas.identity import (
    ChangePasswordRequest,
    CurrentSessionResponse,
    LoginRequest,
    LoginResponse,
)
from app.services.auth import (
    authenticate,
    change_password,
    issue_csrf_token,
    revoke_session,
)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post(
    "/login",
    response_model=LoginResponse,
    responses={
        401: {"model": ErrorResponse},
        403: {"model": ErrorResponse},
        429: {"model": ErrorResponse},
    },
    dependencies=[Depends(verify_request_origin)],
)
def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> LoginResponse:
    client_ip = resolve_client_ip(request, settings)
    throttle: LoginFailureThrottle = request.app.state.login_throttle
    retry_after = throttle.retry_after_seconds(client_ip)
    if retry_after is not None:
        raise ApiError(
            status_code=429,
            code="LOGIN_RATE_LIMITED",
            message="로그인 실패가 너무 많습니다. 잠시 후 다시 시도해 주세요.",
            headers={"Retry-After": str(retry_after)},
        )
    try:
        result = authenticate(
            db,
            login_id=payload.login_id,
            password=payload.password.get_secret_value(),
            client_ip=client_ip,
            user_agent=request.headers.get("user-agent"),
            settings=settings,
        )
    except ApiError as exc:
        if exc.status_code == 401:
            throttle.record_failure(client_ip)
        raise
    db.commit()
    throttle.reset(client_ip)
    response.set_cookie(
        key=settings.session_cookie_name,
        value=result.session_token,
        max_age=settings.session_absolute_hours * 60 * 60,
        secure=settings.session_cookie_secure,
        httponly=True,
        samesite=settings.session_cookie_samesite,
        path="/",
    )
    return LoginResponse(
        user=present_authenticated_user(result.user),
        csrf_token=result.csrf_token,
        idle_expires_at=result.session.idle_expires_at,
        absolute_expires_at=result.session.absolute_expires_at,
    )


@router.get(
    "/me",
    response_model=CurrentSessionResponse,
    responses={401: {"model": ErrorResponse}},
)
def me(
    principal: Principal = Depends(get_current_principal),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> CurrentSessionResponse:
    # 새로고침·새 탭에서도 같은 Session의 CSRF Token을 그대로 돌려준다.
    csrf_token = issue_csrf_token(principal.session, settings=settings)
    if db.is_modified(principal.session):
        db.commit()
    return CurrentSessionResponse(
        user=present_authenticated_user(principal.user),
        csrf_token=csrf_token,
        idle_expires_at=principal.session.idle_expires_at,
        absolute_expires_at=principal.session.absolute_expires_at,
    )


@router.post(
    "/logout",
    response_model=MessageResponse,
    dependencies=[Depends(verify_csrf)],
    responses={401: {"model": ErrorResponse}, 403: {"model": ErrorResponse}},
)
def logout(
    response: Response,
    principal: Principal = Depends(get_current_principal),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> MessageResponse:
    revoke_session(principal.session, reason="사용자 로그아웃")
    db.commit()
    response.delete_cookie(
        key=settings.session_cookie_name,
        secure=settings.session_cookie_secure,
        httponly=True,
        samesite=settings.session_cookie_samesite,
        path="/",
    )
    return MessageResponse(message="로그아웃되었습니다.")


@router.post(
    "/change-password",
    response_model=MessageResponse,
    dependencies=[Depends(verify_csrf)],
    responses={
        400: {"model": ErrorResponse},
        401: {"model": ErrorResponse},
        403: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
    },
)
def update_password(
    payload: ChangePasswordRequest,
    principal: Principal = Depends(get_current_principal),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> MessageResponse:
    change_password(
        db,
        user=principal.user,
        current_session=principal.session,
        current_password=payload.current_password.get_secret_value(),
        new_password=payload.new_password.get_secret_value(),
        settings=settings,
    )
    db.commit()
    return MessageResponse(
        message="비밀번호가 변경되었습니다. 다른 기기의 Session은 종료되었습니다."
    )
