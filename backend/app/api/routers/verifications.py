from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.dependencies import Principal, require_permission, verify_csrf
from app.api.verification_presenters import present_status
from app.core.exceptions import ApiError
from app.db.session import get_db
from app.schemas.common import ErrorResponse
from app.schemas.verification import (
    SecondaryCorrectionRequest,
    VerificationRequest,
    VerificationStatusResponse,
)
from app.services import verifications as verification_service

router = APIRouter(
    prefix="/appointments/{appointment_id}/verifications",
    tags=["verifications"],
)
verification_reader = require_permission("appointment.read")
primary_verifier = require_permission("verification.primary")
secondary_verifier = require_permission("verification.secondary")

MUTATION_RESPONSES: dict[int | str, dict[str, object]] = {
    403: {"model": ErrorResponse},
    404: {"model": ErrorResponse},
    409: {"model": ErrorResponse},
    422: {"model": ErrorResponse},
}


def _duplicate() -> ApiError:
    # 동시에 들어온 같은 단계의 확인은 부분 Unique Index가 마지막으로 막는다.
    return ApiError(
        status_code=409,
        code="VERIFICATION_ALREADY_DONE",
        message="다른 사용자가 먼저 같은 단계의 확인을 저장했습니다. 최신 상태를 다시 확인해 주세요.",
    )


@router.get("", response_model=VerificationStatusResponse)
def get_verification_status(
    appointment_id: UUID,
    _: Principal = Depends(verification_reader),
    db: Session = Depends(get_db),
) -> VerificationStatusResponse:
    return present_status(verification_service.get_verification_status(db, appointment_id))


def _record(
    db: Session,
    *,
    appointment_id: UUID,
    stage: str,
    payload: VerificationRequest,
    principal: Principal,
) -> VerificationStatusResponse:
    try:
        result = verification_service.record_verification(
            db,
            appointment_id=appointment_id,
            stage=stage,
            expected_fingerprint=payload.expected_fingerprint,
            method=payload.method,
            memo=payload.memo,
            actor_user_id=principal.user.id,
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise _duplicate() from exc
    return present_status(result)


@router.post(
    "/primary",
    response_model=VerificationStatusResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_csrf)],
    responses=MUTATION_RESPONSES,
)
def record_primary_verification(
    appointment_id: UUID,
    payload: VerificationRequest,
    principal: Principal = Depends(primary_verifier),
    db: Session = Depends(get_db),
) -> VerificationStatusResponse:
    return _record(
        db, appointment_id=appointment_id, stage="PRIMARY", payload=payload, principal=principal
    )


@router.post(
    "/secondary",
    response_model=VerificationStatusResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_csrf)],
    responses=MUTATION_RESPONSES,
)
def record_secondary_verification(
    appointment_id: UUID,
    payload: VerificationRequest,
    principal: Principal = Depends(secondary_verifier),
    db: Session = Depends(get_db),
) -> VerificationStatusResponse:
    return _record(
        db, appointment_id=appointment_id, stage="SECONDARY", payload=payload, principal=principal
    )


@router.post(
    "/secondary/correct",
    response_model=VerificationStatusResponse,
    dependencies=[Depends(verify_csrf)],
    responses=MUTATION_RESPONSES,
)
def correct_secondary_verification(
    appointment_id: UUID,
    payload: SecondaryCorrectionRequest,
    principal: Principal = Depends(secondary_verifier),
    db: Session = Depends(get_db),
) -> VerificationStatusResponse:
    result = verification_service.correct_secondary(
        db,
        appointment_id=appointment_id,
        verification_id=payload.verification_id,
        reason=payload.reason,
        actor_user_id=principal.user.id,
    )
    db.commit()
    return present_status(result)
