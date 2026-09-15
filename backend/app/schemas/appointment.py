from __future__ import annotations

from datetime import date, datetime, time
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator


ProcedureCode = Literal["UPPER", "COLON"]
ProcedureSet = Literal["SET_60", "SET_90"]
SedationMode = Literal["SEDATED", "NON_SEDATED"]
CareType = Literal["GENERAL", "SCREENING"]
BookingBucket = Literal["STANDARD_MORNING", "AFTERNOON_EXCEPTION"]


class AppointmentProcedureInput(BaseModel):
    procedure_code: ProcedureCode
    sedation_mode: SedationMode


class AppointmentCreateRequest(BaseModel):
    patient_id: UUID
    service_date: date
    start_time: time
    care_type: CareType
    booking_bucket: BookingBucket = "STANDARD_MORNING"
    procedures: list[AppointmentProcedureInput] = Field(min_length=1, max_length=2)
    procedure_set: ProcedureSet | None = None

    @model_validator(mode="after")
    def procedures_must_be_unique(self) -> AppointmentCreateRequest:
        codes = [item.procedure_code for item in self.procedures]
        if len(codes) != len(set(codes)):
            raise ValueError("같은 검사를 중복 선택할 수 없습니다.")
        if self.procedure_set is not None and set(codes) != {"UPPER", "COLON"}:
            raise ValueError("세트60·세트90은 위·대장 동시검사에서만 선택할 수 있습니다.")
        return self


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
    workflow_state: Literal["BOOKED", "CANCELLED"]
    schedule_policy_version: str
    procedures: list[AppointmentProcedureResponse]
    row_version: int
    created_at: datetime
    updated_at: datetime


class AppointmentListResponse(BaseModel):
    items: list[AppointmentResponse]
    total: int = Field(ge=0)


class AvailableSlotResponse(BaseModel):
    start_time: time
    end_time: time


class ScheduleAvailabilityResponse(BaseModel):
    service_date: date
    booking_bucket: BookingBucket
    duration_minutes: int
    procedure_set: ProcedureSet | None
    schedule_policy_version: str
    slots: list[AvailableSlotResponse]
