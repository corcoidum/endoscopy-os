from __future__ import annotations

from datetime import date, datetime, time
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.appointment import BookingBucket, ProcedureCode, ReasonText


OverrideRuleType = Literal["CLOSED", "OPERATING_HOURS", "CAPACITY", "AFTERNOON_ALLOW"]
OverrideStatus = Literal["PENDING", "APPROVED", "REVOKED", "SUPERSEDED"]
PolicyConflictIssue = Literal[
    "CLOSED",
    "OUTSIDE_OPERATING_HOURS",
    "CAPACITY_EXCEEDED",
    "AFTERNOON_NOT_ALLOWED",
]


class ScheduleOverrideCreateRequest(BaseModel):
    service_date: date
    rule_type: OverrideRuleType
    override_start_time: time | None = None
    override_end_time: time | None = None
    override_upper_capacity: int | None = Field(default=None, ge=0, le=50)
    override_colon_capacity: int | None = Field(default=None, ge=0, le=50)
    reason: ReasonText


class ScheduleOverrideRevokeRequest(BaseModel):
    reason: ReasonText


class ScheduleOverrideResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    service_date: date
    rule_type: OverrideRuleType
    override_start_time: time | None
    override_end_time: time | None
    override_upper_capacity: int | None
    override_colon_capacity: int | None
    reason: str
    status: OverrideStatus
    requested_by_user_id: UUID
    approved_by_user_id: UUID | None
    approved_at: datetime | None
    revoked_by_user_id: UUID | None
    revoked_at: datetime | None
    revoke_reason: str | None
    superseded_by_id: UUID | None
    created_at: datetime


class ImpactedAppointmentResponse(BaseModel):
    """승인·취소로 새 규칙과 어긋나게 된 기존 예약. 환자 이름은 포함하지 않는다."""

    id: UUID
    start_time: time
    end_time: time
    booking_bucket: BookingBucket
    procedures: list[ProcedureCode]
    issue: PolicyConflictIssue


class ScheduleOverrideDecisionResponse(BaseModel):
    override: ScheduleOverrideResponse
    impacted_appointments: list[ImpactedAppointmentResponse]


class DayPolicyResponse(BaseModel):
    service_date: date
    closed: bool
    morning_start_time: time | None
    morning_end_time: time | None
    upper_capacity: int | None
    colon_capacity: int | None
    afternoon_allowed: bool
    schedule_policy_version: str


class DayPolicyListResponse(BaseModel):
    items: list[DayPolicyResponse]
