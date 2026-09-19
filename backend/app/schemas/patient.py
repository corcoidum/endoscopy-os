from __future__ import annotations

from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

SexCode = Literal["MALE", "FEMALE"]
AgeMethod = Literal["FULL_AGE", "SCREENING_YEAR_AGE"]


def _strip_optional(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


class PatientCreateRequest(BaseModel):
    chart_number: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=100)
    birth_date: date
    sex: SexCode
    phone: str | None = Field(default=None, max_length=30)
    special_notes: str | None = Field(default=None, max_length=2000)

    _normalize_phone = field_validator("phone", mode="before")(_strip_optional)
    _normalize_notes = field_validator("special_notes", mode="before")(
        _strip_optional
    )


class PatientUpdateRequest(BaseModel):
    row_version: int = Field(ge=1)
    reason: str = Field(min_length=2, max_length=500)
    chart_number: str | None = Field(default=None, min_length=1, max_length=40)
    name: str | None = Field(default=None, min_length=1, max_length=100)
    birth_date: date | None = None
    sex: SexCode | None = None
    phone: str | None = Field(default=None, max_length=30)
    special_notes: str | None = Field(default=None, max_length=2000)


class PatientActivationRequest(BaseModel):
    row_version: int = Field(ge=1)
    is_active: bool
    reason: str = Field(min_length=2, max_length=500)


class PatientSummaryResponse(BaseModel):
    id: UUID
    chart_number: str
    name: str
    birth_date: date
    sex: SexCode
    age: int
    age_method: AgeMethod
    age_reference_date: date
    cancellation_count: int
    no_show_count: int
    requires_booking_review: bool
    is_active: bool
    row_version: int


class PatientDetailResponse(PatientSummaryResponse):
    phone: str | None
    special_notes: str | None
    created_at: datetime
    updated_at: datetime


class PatientListResponse(BaseModel):
    items: list[PatientSummaryResponse]
    total: int = Field(ge=0)
    limit: int = Field(ge=1)
    offset: int = Field(ge=0)


class PatientWarningResponse(BaseModel):
    code: str
    message: str
    candidates: list[PatientSummaryResponse] = Field(default_factory=list)


class PatientMutationResponse(BaseModel):
    patient: PatientDetailResponse
    warnings: list[PatientWarningResponse] = Field(default_factory=list)


class ChartNumberAvailabilityResponse(BaseModel):
    chart_number: str
    normalized_chart_number: str
    available: bool
    existing_patient_id: UUID | None = None
    existing_patient_active: bool | None = None


class PatientHistoryEventResponse(BaseModel):
    id: UUID
    event_type: Literal[
        "CREATED", "UPDATED", "DEACTIVATED", "REACTIVATED"
    ]
    changed_fields: list[str]
    before_values: dict[str, object] | None
    after_values: dict[str, object]
    reason: str
    actor_user_id: UUID
    actor_display_name: str
    occurred_at: datetime


class PatientAgeResponse(BaseModel):
    patient_id: UUID
    birth_date: date
    reference_date: date
    method: AgeMethod
    age: int
