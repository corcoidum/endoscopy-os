from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.dependencies import Principal, require_permission, verify_csrf
from app.api.medication_presenters import present_review
from app.core.config import Settings, get_settings
from app.core.exceptions import ApiError
from app.db.session import get_db
from app.schemas.common import ErrorResponse
from app.schemas.medication import (
    MedicationChecklistRequest,
    MedicationDecisionRequest,
    MedicationHoldConfirmationRequest,
    MedicationItemCreateRequest,
    MedicationItemDecisionRequest,
    MedicationItemNotifyRequest,
    MedicationItemWithdrawRequest,
    MedicationReviewResponse,
)
from app.services import medications as medication_service

router = APIRouter(
    prefix="/appointments/{appointment_id}/medication-review",
    tags=["medications"],
)
medication_reader = require_permission("medication.read")
medication_writer = require_permission("medication.write")
decision_writer = require_permission("medication.decision")
DECISION_PERMISSION = "medication.decision"

MUTATION_RESPONSES: dict[int | str, dict[str, object]] = {
    403: {"model": ErrorResponse},
    404: {"model": ErrorResponse},
    409: {"model": ErrorResponse},
    422: {"model": ErrorResponse},
}


def _decision(payload: MedicationDecisionRequest) -> medication_service.DecisionInput:
    return medication_service.DecisionInput(
        decision=payload.decision,
        hold_days=payload.hold_days,
        rationale=payload.rationale,
        physician_profile_id=payload.physician_profile_id,
        physician_confirmed=payload.physician_confirmed,
    )


def _conflict() -> ApiError:
    # 같은 약의 유효 결정이 둘이 되려는 경합은 부분 Unique Index가 마지막으로 막는다.
    return ApiError(
        status_code=409,
        code="MEDICATION_ITEM_STALE",
        message="다른 사용자가 먼저 복용약 기록을 바꿨습니다. 최신 내용을 확인해 주세요.",
    )


def _commit(db: Session) -> None:
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise _conflict() from exc


@router.get("", response_model=MedicationReviewResponse)
def get_medication_review(
    appointment_id: UUID,
    _: Principal = Depends(medication_reader),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> MedicationReviewResponse:
    return present_review(
        medication_service.get_medication_review(db, appointment_id, settings=settings)
    )


@router.put(
    "/checklist",
    response_model=MedicationReviewResponse,
    dependencies=[Depends(verify_csrf)],
    responses=MUTATION_RESPONSES,
)
def save_checklist(
    appointment_id: UUID,
    payload: MedicationChecklistRequest,
    principal: Principal = Depends(medication_writer),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> MedicationReviewResponse:
    result = medication_service.save_checklist(
        db,
        appointment_id=appointment_id,
        expected_row_version=payload.expected_row_version,
        checklist=medication_service.ChecklistInput(
            medication_status=payload.medication_status,
            medication_list=payload.medication_list,
            categories=payload.categories.model_dump(),
            surgery_history=payload.surgery_history,
            cardiovascular_history=payload.cardiovascular_history,
            emr_recorded=payload.emr_recorded,
        ),
        actor_user_id=principal.user.id,
        settings=settings,
    )
    _commit(db)
    return present_review(result)


@router.post(
    "/items",
    response_model=MedicationReviewResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_csrf)],
    responses=MUTATION_RESPONSES,
)
def add_item(
    appointment_id: UUID,
    payload: MedicationItemCreateRequest,
    principal: Principal = Depends(medication_writer),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> MedicationReviewResponse:
    # 의사 결정을 함께 기록하려면 결정 기록 권한도 있어야 한다.
    if payload.decision is not None and DECISION_PERMISSION not in principal.permissions:
        raise ApiError(
            status_code=403,
            code="PERMISSION_DENIED",
            message="의사 결정을 기록할 권한이 없습니다.",
        )
    result = medication_service.add_item(
        db,
        appointment_id=appointment_id,
        medication_name=payload.medication_name,
        decision=_decision(payload.decision) if payload.decision is not None else None,
        actor_user_id=principal.user.id,
        settings=settings,
    )
    _commit(db)
    return present_review(result)


@router.post(
    "/items/{item_key}/decision",
    response_model=MedicationReviewResponse,
    dependencies=[Depends(verify_csrf)],
    responses=MUTATION_RESPONSES,
)
def record_decision(
    appointment_id: UUID,
    item_key: UUID,
    payload: MedicationItemDecisionRequest,
    principal: Principal = Depends(decision_writer),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> MedicationReviewResponse:
    result = medication_service.record_decision(
        db,
        appointment_id=appointment_id,
        item_key=item_key,
        expected_revision=payload.expected_revision,
        decision=_decision(payload),
        actor_user_id=principal.user.id,
        settings=settings,
    )
    _commit(db)
    return present_review(result)


@router.post(
    "/items/{item_key}/withdraw",
    response_model=MedicationReviewResponse,
    dependencies=[Depends(verify_csrf)],
    responses=MUTATION_RESPONSES,
)
def withdraw_item(
    appointment_id: UUID,
    item_key: UUID,
    payload: MedicationItemWithdrawRequest,
    principal: Principal = Depends(medication_writer),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> MedicationReviewResponse:
    result = medication_service.withdraw_item(
        db,
        appointment_id=appointment_id,
        item_key=item_key,
        expected_revision=payload.expected_revision,
        reason=payload.reason,
        actor_user_id=principal.user.id,
        settings=settings,
    )
    _commit(db)
    return present_review(result)


@router.post(
    "/items/{item_key}/notify",
    response_model=MedicationReviewResponse,
    dependencies=[Depends(verify_csrf)],
    responses=MUTATION_RESPONSES,
)
def notify_patient(
    appointment_id: UUID,
    item_key: UUID,
    payload: MedicationItemNotifyRequest,
    principal: Principal = Depends(medication_writer),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> MedicationReviewResponse:
    result = medication_service.notify_patient(
        db,
        appointment_id=appointment_id,
        item_key=item_key,
        expected_revision=payload.expected_revision,
        actor_user_id=principal.user.id,
        settings=settings,
    )
    _commit(db)
    return present_review(result)


@router.post(
    "/items/{item_key}/hold-confirmation",
    response_model=MedicationReviewResponse,
    dependencies=[Depends(verify_csrf)],
    responses=MUTATION_RESPONSES,
)
def confirm_hold(
    appointment_id: UUID,
    item_key: UUID,
    payload: MedicationHoldConfirmationRequest,
    principal: Principal = Depends(medication_writer),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> MedicationReviewResponse:
    result = medication_service.confirm_hold(
        db,
        appointment_id=appointment_id,
        item_key=item_key,
        expected_revision=payload.expected_revision,
        confirmed_on=payload.confirmed_on,
        actor_user_id=principal.user.id,
        settings=settings,
    )
    _commit(db)
    return present_review(result)
