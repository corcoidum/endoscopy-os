from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    SecretStr,
    field_validator,
    model_validator,
)


LOGIN_ID_PATTERN = r"^[A-Za-z0-9._-]+$"


class PermissionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    code: str
    description_ko: str


class RoleSummaryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    code: str
    name_ko: str
    is_active: bool


class RoleResponse(RoleSummaryResponse):
    permissions: list[PermissionResponse]


class StaffProfileResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    display_name: str
    staff_type: str
    employee_code: str | None
    is_active: bool


class UserResponse(BaseModel):
    id: UUID
    login_id: str
    display_name: str
    is_active: bool
    must_change_password: bool
    locked_until: datetime | None
    staff_profile: StaffProfileResponse | None
    roles: list[RoleSummaryResponse]
    permissions: list[str] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class AuthenticatedUserResponse(BaseModel):
    id: UUID
    login_id: str
    display_name: str
    must_change_password: bool
    roles: list[str]
    permissions: list[str]


class LoginRequest(BaseModel):
    login_id: str = Field(
        min_length=3, max_length=80, pattern=LOGIN_ID_PATTERN
    )
    password: SecretStr = Field(min_length=1, max_length=128)


class LoginResponse(BaseModel):
    user: AuthenticatedUserResponse
    csrf_token: str
    idle_expires_at: datetime
    absolute_expires_at: datetime


class CurrentSessionResponse(LoginResponse):
    pass


class ChangePasswordRequest(BaseModel):
    current_password: SecretStr = Field(min_length=1, max_length=128)
    new_password: SecretStr = Field(min_length=12, max_length=128)

    @model_validator(mode="after")
    def password_must_change(self) -> ChangePasswordRequest:
        if (
            self.current_password.get_secret_value()
            == self.new_password.get_secret_value()
        ):
            raise ValueError("새 비밀번호는 현재 비밀번호와 달라야 합니다.")
        return self


class UserCreateRequest(BaseModel):
    login_id: str = Field(
        min_length=3, max_length=80, pattern=LOGIN_ID_PATTERN
    )
    password: SecretStr = Field(min_length=12, max_length=128)
    display_name: str = Field(min_length=1, max_length=100)
    staff_profile_id: UUID | None = None
    role_ids: list[UUID] = Field(min_length=1)

    @field_validator("role_ids")
    @classmethod
    def role_ids_must_be_unique(cls, value: list[UUID]) -> list[UUID]:
        if len(value) != len(set(value)):
            raise ValueError("역할을 중복 지정할 수 없습니다.")
        return value


class UserRoleUpdateRequest(BaseModel):
    role_ids: list[UUID] = Field(min_length=1)

    @field_validator("role_ids")
    @classmethod
    def role_ids_must_be_unique(cls, value: list[UUID]) -> list[UUID]:
        if len(value) != len(set(value)):
            raise ValueError("역할을 중복 지정할 수 없습니다.")
        return value


class UserActivationRequest(BaseModel):
    is_active: bool
    reason: str = Field(min_length=2, max_length=200)
