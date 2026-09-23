from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, StringConstraints

StaffType = Literal["DOCTOR", "NURSE", "ASSISTANT", "ADMINISTRATIVE", "OTHER"]


class StaffProfileCreateRequest(BaseModel):
    display_name: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)
    ]
    staff_type: StaffType
    employee_code: (
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=40)] | None
    ) = None


class StaffProfileActivationRequest(BaseModel):
    is_active: bool


class StaffProfileResponse(BaseModel):
    id: UUID
    display_name: str
    staff_type: StaffType
    employee_code: str | None
    is_active: bool
    deactivated_at: datetime | None


class StaffProfileListResponse(BaseModel):
    items: list[StaffProfileResponse]
