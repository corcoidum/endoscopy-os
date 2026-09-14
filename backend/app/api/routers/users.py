from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.dependencies import Principal, require_permission, verify_csrf
from app.api.presenters import present_role, present_user
from app.core.exceptions import ApiError
from app.db.session import get_db
from app.schemas.common import ErrorResponse
from app.schemas.identity import (
    PermissionResponse,
    RoleResponse,
    UserActivationRequest,
    UserCreateRequest,
    UserResponse,
    UserRoleUpdateRequest,
)
from app.services import users as user_service


router = APIRouter(prefix="/users", tags=["users"])
identity_manager = require_permission("identity.manage")


@router.get("", response_model=list[UserResponse])
def get_users(
    include_inactive: bool = False,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    _: Principal = Depends(identity_manager),
    db: Session = Depends(get_db),
) -> list[UserResponse]:
    return [
        present_user(user)
        for user in user_service.list_users(
            db,
            include_inactive=include_inactive,
            limit=limit,
            offset=offset,
        )
    ]


@router.get("/roles", response_model=list[RoleResponse])
def get_roles(
    include_inactive: bool = False,
    _: Principal = Depends(identity_manager),
    db: Session = Depends(get_db),
) -> list[RoleResponse]:
    return [
        present_role(role)
        for role in user_service.list_roles(
            db, include_inactive=include_inactive
        )
    ]


@router.get("/permissions", response_model=list[PermissionResponse])
def get_permissions(
    _: Principal = Depends(identity_manager),
    db: Session = Depends(get_db),
) -> list[PermissionResponse]:
    return [
        PermissionResponse.model_validate(permission)
        for permission in user_service.list_permissions(db)
    ]


@router.get("/{user_id}", response_model=UserResponse)
def get_user(
    user_id: UUID,
    _: Principal = Depends(identity_manager),
    db: Session = Depends(get_db),
) -> UserResponse:
    return present_user(user_service.get_user(db, user_id))


@router.post(
    "",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_csrf)],
    responses={
        403: {"model": ErrorResponse},
        409: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
    },
)
def create_user(
    payload: UserCreateRequest,
    _: Principal = Depends(identity_manager),
    db: Session = Depends(get_db),
) -> UserResponse:
    try:
        user = user_service.create_user(
            db,
            login_id=payload.login_id,
            password=payload.password.get_secret_value(),
            display_name=payload.display_name,
            staff_profile_id=payload.staff_profile_id,
            role_ids=payload.role_ids,
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ApiError(
            status_code=409,
            code="IDENTITY_CONFLICT",
            message="로그인 ID 또는 직원 Profile이 이미 사용 중입니다.",
        ) from exc
    return present_user(user)

@router.put(
    "/{user_id}/roles",
    response_model=UserResponse,
    dependencies=[Depends(verify_csrf)],
)
def update_user_roles(
    user_id: UUID,
    payload: UserRoleUpdateRequest,
    principal: Principal = Depends(identity_manager),
    db: Session = Depends(get_db),
) -> UserResponse:
    user = user_service.replace_user_roles(
        db,
        target_user_id=user_id,
        actor_user_id=principal.user.id,
        role_ids=payload.role_ids,
    )
    db.commit()
    return present_user(user)


@router.patch(
    "/{user_id}/activation",
    response_model=UserResponse,
    dependencies=[Depends(verify_csrf)],
)
def update_user_activation(
    user_id: UUID,
    payload: UserActivationRequest,
    principal: Principal = Depends(identity_manager),
    db: Session = Depends(get_db),
) -> UserResponse:
    # payload.reason은 Sprint 7 AuditLog 도입 시 같은 Transaction에 영구 저장한다.
    user = user_service.set_user_activation(
        db,
        target_user_id=user_id,
        actor_user_id=principal.user.id,
        is_active=payload.is_active,
    )
    db.commit()
    return present_user(user)
