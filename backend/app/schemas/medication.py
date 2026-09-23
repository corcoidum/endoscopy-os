from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field, StringConstraints

from app.schemas.appointment import MedicationState, ReasonText, WorkflowState

MedicationStatus = Literal["UNCHECKED", "LIST_CONFIRMED", "NONE_CONFIRMED"]
MedicationDecision = Literal["HOLD", "CONTINUE"]
ItemDecision = Literal["PENDING", "HOLD", "CONTINUE"]
ItemStatus = Literal["ACTIVE", "SUPERSEDED", "WITHDRAWN"]

LongText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)]
MedicationName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)
]
ShortText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)]


class MedicationCategories(BaseModel):
    """직원이 확인한 복용 분류. 여러 분류를 함께 고를 수 있다."""

    anticoagulant: bool = False
    antiplatelet: bool = False
    circulation: bool = False
    cardiac: bool = False
    neurologic: bool = False
    chronic_disease: bool = False


class MedicationChecklistRequest(BaseModel):
    # 처음 저장할 때는 비워 두고, 이후에는 화면이 본 row_version을 보낸다.
    expected_row_version: int | None = Field(default=None, ge=0)
    medication_status: MedicationStatus
    medication_list: LongText | None = None
    categories: MedicationCategories = Field(default_factory=MedicationCategories)
    surgery_history: LongText | None = None
    cardiovascular_history: LongText | None = None
    emr_recorded: bool = False


class MedicationDecisionRequest(BaseModel):
    """의사가 정한 중단·지속 결정. 시스템은 값을 제안하거나 채우지 않는다."""

    decision: MedicationDecision
    hold_days: int | None = Field(default=None, ge=1, le=90)
    rationale: ShortText | None = None
    physician_profile_id: UUID
    physician_confirmed: bool


class MedicationItemCreateRequest(BaseModel):
    medication_name: MedicationName
    decision: MedicationDecisionRequest | None = None


class MedicationItemDecisionRequest(MedicationDecisionRequest):
    expected_revision: int = Field(ge=1)


class MedicationItemWithdrawRequest(BaseModel):
    expected_revision: int = Field(ge=1)
    reason: ReasonText


class MedicationItemNotifyRequest(BaseModel):
    expected_revision: int = Field(ge=1)


class MedicationHoldConfirmationRequest(BaseModel):
    expected_revision: int = Field(ge=1)
    confirmed_on: date


class PhysicianProfileResponse(BaseModel):
    id: UUID
    display_name: str


class MedicationChecklistSnapshot(BaseModel):
    medication_status: MedicationStatus
    medication_list: str | None
    categories: MedicationCategories
    surgery_history: str | None
    cardiovascular_history: str | None
    emr_recorded: bool


class MedicationChecklistResponse(MedicationChecklistSnapshot):
    confirmed_by_user_id: UUID | None
    confirmed_by_name: str | None
    confirmed_at: datetime | None
    updated_by_name: str | None
    updated_at: datetime
    row_version: int


class MedicationChecklistRevisionResponse(BaseModel):
    revision: int
    snapshot: MedicationChecklistSnapshot
    saved_by_name: str | None
    saved_at: datetime


class MedicationItemResponse(BaseModel):
    id: UUID
    item_key: UUID
    revision: int
    status: ItemStatus
    medication_name: str
    decision: ItemDecision
    hold_days: int | None
    rationale: str | None
    physician_profile_id: UUID | None
    physician_name: str | None
    decided_for_service_date: date | None
    # 결정 당시 검사일이 지금 검사일과 다르면 의사 재검토가 필요하다.
    needs_re_review: bool
    recorded_by_user_id: UUID
    recorded_by_name: str | None
    recorded_at: datetime
    patient_notified_at: datetime | None
    patient_notified_by_name: str | None
    hold_confirmed_on: date | None
    hold_confirmed_at: datetime | None
    hold_confirmed_by_name: str | None
    ended_at: datetime | None
    ended_by_name: str | None
    end_reason: str | None


class MedicationReviewResponse(BaseModel):
    appointment_id: UUID
    workflow_state: WorkflowState
    service_date: date
    has_colon: bool
    state: MedicationState
    checklist: MedicationChecklistResponse | None
    # 현재 유효한 약별 결정과, 지난 결정·철회를 포함한 전체 이력.
    items: list[MedicationItemResponse]
    item_history: list[MedicationItemResponse]
    checklist_history: list[MedicationChecklistRevisionResponse]
    physicians: list[PhysicianProfileResponse]
