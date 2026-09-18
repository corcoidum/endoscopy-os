from __future__ import annotations

from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.dependencies import Principal, require_permission, verify_csrf
from app.api.schedule_presenters import (
    present_day_policy,
    present_decision,
    present_override,
)
from app.core.exceptions import ApiError
from app.db.session import get_db
from app.schemas.common import ErrorResponse
from app.schemas.schedule import (
    AdditionalSlotCreateRequest,
    AdditionalSlotResponse,
    AdditionalSlotRevokeRequest,
    DayPolicyListResponse,
    ScheduleOverrideCreateRequest,
    ScheduleOverrideDecisionResponse,
    ScheduleOverrideResponse,
    ScheduleOverrideRevokeRequest,
)
from app.services import schedule_overrides as override_service
from app.services import additional_slots as additional_slot_service


router = APIRouter(prefix="/schedule", tags=["schedule"])
schedule_reader = require_permission("appointment.read")
override_approver = require_permission("schedule_override.approve")


@router.get("/additional-slots", response_model=list[AdditionalSlotResponse])
def get_additional_slots(
    service_date: date,
    _: Principal = Depends(schedule_reader),
    db: Session = Depends(get_db),
) -> list[AdditionalSlotResponse]:
    return [
        AdditionalSlotResponse.model_validate(item)
        for item in additional_slot_service.list_additional_slots(
            db, service_date=service_date
        )
    ]


@router.post(
    "/additional-slots",
    response_model=AdditionalSlotResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_csrf)],
    responses={403: {"model": ErrorResponse}, 409: {"model": ErrorResponse}, 422: {"model": ErrorResponse}},
)
def create_additional_slot(
    payload: AdditionalSlotCreateRequest,
    principal: Principal = Depends(override_approver),
    db: Session = Depends(get_db),
) -> AdditionalSlotResponse:
    try:
        slot = additional_slot_service.create_additional_slot(
            db,
            service_date=payload.service_date,
            start_time=payload.start_time,
            reason=payload.reason,
            actor_user_id=principal.user.id,
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ApiError(
            status_code=409,
            code="ADDITIONAL_SLOT_CONFLICT",
            message="같은 시간에 이미 승인된 연장 슬롯이 있습니다.",
        ) from exc
    return AdditionalSlotResponse.model_validate(slot)


@router.post(
    "/additional-slots/{slot_id}/revoke",
    response_model=AdditionalSlotResponse,
    dependencies=[Depends(verify_csrf)],
    responses={403: {"model": ErrorResponse}, 404: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
)
def revoke_additional_slot(
    slot_id: UUID,
    payload: AdditionalSlotRevokeRequest,
    principal: Principal = Depends(override_approver),
    db: Session = Depends(get_db),
) -> AdditionalSlotResponse:
    slot = additional_slot_service.revoke_additional_slot(
        db,
        slot_id=slot_id,
        reason=payload.reason,
        actor_user_id=principal.user.id,
    )
    db.commit()
    return AdditionalSlotResponse.model_validate(slot)


@router.get("/day-policies", response_model=DayPolicyListResponse)
def get_day_policies(
    start_date: date,
    end_date: date,
    _: Principal = Depends(schedule_reader),
    db: Session = Depends(get_db),
) -> DayPolicyListResponse:
    policies = override_service.resolve_day_policies(
        db, start_date=start_date, end_date=end_date
    )
    return DayPolicyListResponse(
        items=[present_day_policy(policy) for policy in policies]
    )


@router.get("/overrides", response_model=list[ScheduleOverrideResponse])
def get_overrides(
    start_date: date,
    end_date: date,
    _: Principal = Depends(schedule_reader),
    db: Session = Depends(get_db),
) -> list[ScheduleOverrideResponse]:
    return [
        present_override(item)
        for item in override_service.list_overrides(
            db, start_date=start_date, end_date=end_date
        )
    ]


@router.post(
    "/overrides",
    response_model=ScheduleOverrideResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_csrf)],
    responses={403: {"model": ErrorResponse}, 422: {"model": ErrorResponse}},
)
def create_override(
    payload: ScheduleOverrideCreateRequest,
    principal: Principal = Depends(override_approver),
    db: Session = Depends(get_db),
) -> ScheduleOverrideResponse:
    override = override_service.create_override(
        db,
        service_date=payload.service_date,
        rule_type=payload.rule_type,
        override_start_time=payload.override_start_time,
        override_end_time=payload.override_end_time,
        override_upper_capacity=payload.override_upper_capacity,
        override_colon_capacity=payload.override_colon_capacity,
        reason=payload.reason,
        actor_user_id=principal.user.id,
    )
    db.commit()
    return present_override(override)


@router.post(
    "/overrides/{override_id}/approve",
    response_model=ScheduleOverrideDecisionResponse,
    dependencies=[Depends(verify_csrf)],
    responses={409: {"model": ErrorResponse}},
)
def approve_override(
    override_id: UUID,
    principal: Principal = Depends(override_approver),
    db: Session = Depends(get_db),
) -> ScheduleOverrideDecisionResponse:
    try:
        override, conflicts = override_service.approve_override(
            db, override_id=override_id, actor_user_id=principal.user.id
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ApiError(
            status_code=409,
            code="CONFLICTING_OVERRIDES",
            message="같은 날짜에 이미 승인된 같은 종류의 일정 예외가 있습니다.",
        ) from exc
    return present_decision(override, conflicts)


@router.post(
    "/overrides/{override_id}/revoke",
    response_model=ScheduleOverrideDecisionResponse,
    dependencies=[Depends(verify_csrf)],
    responses={409: {"model": ErrorResponse}},
)
def revoke_override(
    override_id: UUID,
    payload: ScheduleOverrideRevokeRequest,
    principal: Principal = Depends(override_approver),
    db: Session = Depends(get_db),
) -> ScheduleOverrideDecisionResponse:
    override, conflicts = override_service.revoke_override(
        db,
        override_id=override_id,
        reason=payload.reason,
        actor_user_id=principal.user.id,
    )
    db.commit()
    return present_decision(override, conflicts)
