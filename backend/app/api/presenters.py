from __future__ import annotations

from datetime import UTC, datetime

from app.models import Role, User
from app.schemas.identity import (
    AuthenticatedUserResponse,
    PermissionResponse,
    RoleResponse,
    RoleSummaryResponse,
    StaffProfileResponse,
    UserResponse,
)


def present_authenticated_user(user: User) -> AuthenticatedUserResponse:
    now = datetime.now(UTC)
    return AuthenticatedUserResponse(
        id=user.id,
        login_id=user.login_id_normalized,
        display_name=user.display_name,
        must_change_password=user.must_change_password,
        roles=sorted(user.active_role_codes(now)),
        permissions=sorted(user.active_permission_codes(now)),
    )


def present_user(user: User) -> UserResponse:
    now = datetime.now(UTC)
    assignments = sorted(
        user.role_assignments, key=lambda assignment: assignment.role.code
    )
    return UserResponse(
        id=user.id,
        login_id=user.login_id_normalized,
        display_name=user.display_name,
        is_active=user.is_active,
        must_change_password=user.must_change_password,
        locked_until=user.locked_until,
        staff_profile=(
            StaffProfileResponse.model_validate(user.staff_profile)
            if user.staff_profile
            else None
        ),
        roles=[
            RoleSummaryResponse.model_validate(assignment.role)
            for assignment in assignments
        ],
        permissions=sorted(user.active_permission_codes(now)),
        created_at=user.created_at,
        updated_at=user.updated_at,
    )


def present_role(role: Role) -> RoleResponse:
    permissions = sorted(
        (
            assignment.permission
            for assignment in role.permission_assignments
        ),
        key=lambda permission: permission.code,
    )
    return RoleResponse(
        id=role.id,
        code=role.code,
        name_ko=role.name_ko,
        is_active=role.is_active,
        permissions=[
            PermissionResponse.model_validate(permission)
            for permission in permissions
        ],
    )
