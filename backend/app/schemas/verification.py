from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field, StringConstraints

from app.schemas.appointment import ReasonText, VerificationState, WorkflowState

VerificationStage = Literal["PRIMARY", "SECONDARY"]
VerificationMethod = Literal["IN_PERSON", "ID_DOCUMENT", "PHONE", "CHART_RECORD"]
InvalidationType = Literal["CORE_CHANGED", "CORRECTED"]
AgeMethod = Literal["FULL_AGE", "SCREENING_YEAR_AGE"]

Fingerprint = Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{64}$")]
MemoText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)]


class VerificationRequest(BaseModel):
    """화면에 보인 핵심정보의 지문을 함께 보내 오래된 화면의 확인을 막는다."""

    expected_fingerprint: Fingerprint
    method: VerificationMethod
    memo: MemoText | None = None


class SecondaryCorrectionRequest(BaseModel):
    verification_id: UUID
    reason: ReasonText


class VerificationProcedure(BaseModel):
    procedure_code: Literal["UPPER", "COLON"]
    sedation_mode: Literal["SEDATED", "NON_SEDATED"]


class VerificationSubject(BaseModel):
    """확인 대상 핵심정보. 현재 값과 확인 당시 Snapshot에 같은 모양으로 쓴다."""

    name: str
    chart_number: str
    birth_date: date
    sex: Literal["MALE", "FEMALE"]
    service_date: date
    start_time: str
    procedures: list[VerificationProcedure]
    procedure_set: Literal["SET_60", "SET_90"] | None
    care_type: Literal["GENERAL", "SCREENING"]
    computed_age: int
    age_method: AgeMethod
    age_reference_date: date


class VerificationRecordResponse(BaseModel):
    id: UUID
    stage: VerificationStage
    is_valid: bool
    method: VerificationMethod
    memo: str | None
    verified_by_user_id: UUID
    verified_by_name: str
    verified_at: datetime
    appointment_row_version: int
    subject: VerificationSubject
    invalidated_at: datetime | None
    invalidated_by_user_id: UUID | None
    invalidated_by_name: str | None
    invalidation_type: InvalidationType | None
    invalidation_reason: str | None


class VerificationStatusResponse(BaseModel):
    appointment_id: UUID
    workflow_state: WorkflowState
    state: VerificationState
    fingerprint: str
    current: VerificationSubject
    primary: VerificationRecordResponse | None
    secondary: VerificationRecordResponse | None
    last_invalidation: VerificationRecordResponse | None
    history: list[VerificationRecordResponse] = Field(
        description="무효·정정된 확인을 포함한 전체 이력(최신순)"
    )
