from __future__ import annotations

from datetime import date, datetime, time
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field, StringConstraints, model_validator

ProcedureCode = Literal["UPPER", "COLON"]
ProcedureSet = Literal["SET_60", "SET_90"]
SedationMode = Literal["SEDATED", "NON_SEDATED"]
CareType = Literal["GENERAL", "SCREENING"]
BookingBucket = Literal[
    "STANDARD_MORNING", "AFTERNOON_EXCEPTION", "SAME_DAY_EXTENSION"
]
BookingOrigin = Literal["ADVANCE", "SAME_DAY"]
WorkflowState = Literal["BOOKED", "CANCELLED", "NO_SHOW"]
VerificationState = Literal["UNVERIFIED", "PRIMARY_DONE", "VERIFIED", "REVERIFY_REQUIRED"]
ExceptionStatus = Literal["NOT_APPLICABLE", "PENDING", "CONFIRMED"]
AppointmentEventType = Literal[
    "CREATED", "UPDATED", "CANCELLED", "NO_SHOW", "EXCEPTION_CONFIRMED"
]
ReasonText = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)
]


class AppointmentProcedureInput(BaseModel):
    procedure_code: ProcedureCode
    sedation_mode: SedationMode


def _ensure_unique_procedures(
    procedures: list[AppointmentProcedureInput],
) -> set[str]:
    codes = [item.procedure_code for item in procedures]
    if len(codes) != len(set(codes)):
        raise ValueError("같은 검사를 중복 선택할 수 없습니다.")
    return set(codes)


class AppointmentCreateRequest(BaseModel):
    patient_id: UUID
    service_date: date
    start_time: time
    care_type: CareType
    booking_bucket: BookingBucket = "STANDARD_MORNING"
    booking_origin: BookingOrigin = "ADVANCE"
    procedures: list[AppointmentProcedureInput] = Field(min_length=1, max_length=2)
    procedure_set: ProcedureSet | None = None
    exception_reason: ReasonText | None = None
    additional_slot_id: UUID | None = None
    same_day_reason: ReasonText | None = None
    same_day_preparation_confirmed: bool = False
    same_day_clinician_confirmed: bool = False
    same_day_escort_confirmed: bool = False

    @model_validator(mode="after")
    def procedures_must_be_unique(self) -> AppointmentCreateRequest:
        codes = _ensure_unique_procedures(self.procedures)
        if self.procedure_set is not None and codes != {"UPPER", "COLON"}:
            raise ValueError("세트60·세트90은 위·대장 동시검사에서만 선택할 수 있습니다.")
        if self.booking_bucket == "AFTERNOON_EXCEPTION" and not self.exception_reason:
            raise ValueError("14:00 오후 예외 예약에는 사유가 필요합니다.")
        if self.booking_bucket == "STANDARD_MORNING" and self.exception_reason:
            raise ValueError("일반 오전 예약에는 오후 예외 사유를 입력하지 않습니다.")
        if self.booking_origin == "ADVANCE" and (
            self.booking_bucket == "SAME_DAY_EXTENSION"
            or self.additional_slot_id is not None
            or self.same_day_reason is not None
            or self.same_day_preparation_confirmed
            or self.same_day_clinician_confirmed
            or self.same_day_escort_confirmed
        ):
            raise ValueError("일반 사전 예약에는 당일 추가 정보를 입력하지 않습니다.")
        if self.booking_origin == "SAME_DAY":
            if self.booking_bucket == "AFTERNOON_EXCEPTION":
                raise ValueError("14:00 오후 예외와 당일 추가 예약은 별도로 등록합니다.")
            if not self.same_day_reason:
                raise ValueError("당일 위내시경 요청 사유가 필요합니다.")
            if not (
                self.same_day_preparation_confirmed
                and self.same_day_clinician_confirmed
            ):
                raise ValueError("검사 준비와 의료진 시행 가능 확인이 필요합니다.")
            if self.booking_bucket == "SAME_DAY_EXTENSION" and self.additional_slot_id is None:
                raise ValueError("당일 연장 예약에는 승인된 연장 슬롯이 필요합니다.")
            if self.booking_bucket != "SAME_DAY_EXTENSION" and self.additional_slot_id is not None:
                raise ValueError("일반 빈 슬롯 예약에는 연장 슬롯을 지정하지 않습니다.")
        return self


class AppointmentChangeRequest(BaseModel):
    row_version: int = Field(ge=1)
    reason: ReasonText
    service_date: date | None = None
    start_time: time | None = None
    care_type: CareType | None = None
    procedures: list[AppointmentProcedureInput] | None = Field(
        default=None, min_length=1, max_length=2
    )
    procedure_set: ProcedureSet | None = None

    @model_validator(mode="after")
    def procedures_must_be_unique(self) -> AppointmentChangeRequest:
        if self.procedures is not None:
            _ensure_unique_procedures(self.procedures)
        return self


class AppointmentStateChangeRequest(BaseModel):
    row_version: int = Field(ge=1)
    reason: ReasonText


class ExceptionConfirmRequest(BaseModel):
    row_version: int = Field(ge=1)
    memo: ReasonText


class AppointmentProcedureResponse(BaseModel):
    procedure_code: ProcedureCode
    sedation_mode: SedationMode


class AppointmentResponse(BaseModel):
    id: UUID
    patient_id: UUID
    patient_name: str
    chart_number: str
    birth_date: date
    sex: Literal["MALE", "FEMALE"]
    age: int
    age_method: Literal["FULL_AGE", "SCREENING_YEAR_AGE"]
    resource_code: str
    service_date: date
    start_time: time
    end_time: time
    duration_minutes: int
    procedure_set: ProcedureSet | None
    care_type: CareType
    booking_bucket: BookingBucket
    booking_origin: BookingOrigin
    additional_slot_id: UUID | None
    same_day_reason: str | None
    same_day_preparation_confirmed: bool
    same_day_clinician_confirmed: bool
    same_day_escort_confirmed: bool
    same_day_confirmed_at: datetime | None
    workflow_state: WorkflowState
    exception_status: ExceptionStatus
    exception_reason: str | None
    exception_memo: str | None
    exception_registered_by_user_id: UUID | None
    exception_confirmed_by_user_id: UUID | None
    exception_confirmed_at: datetime | None
    schedule_policy_version: str
    procedures: list[AppointmentProcedureResponse]
    verification_state: VerificationState
    row_version: int
    created_at: datetime
    updated_at: datetime


class AppointmentListResponse(BaseModel):
    items: list[AppointmentResponse]
    total: int = Field(ge=0)


class AppointmentHistoryEventResponse(BaseModel):
    id: UUID
    event_type: AppointmentEventType
    changed_fields: list[str]
    before_values: dict[str, object] | None
    after_values: dict[str, object]
    reason: str
    actor_user_id: UUID
    occurred_at: datetime


class AvailableSlotResponse(BaseModel):
    start_time: time
    end_time: time
    slot_type: Literal["SAME_DAY_EXTENSION"] | None = None
    additional_slot_id: UUID | None = None


class ScheduleAvailabilityResponse(BaseModel):
    service_date: date
    booking_bucket: BookingBucket
    duration_minutes: int
    procedure_set: ProcedureSet | None
    schedule_policy_version: str
    slots: list[AvailableSlotResponse]
