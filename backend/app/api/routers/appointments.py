from __future__ import annotations

from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.api.appointment_presenters import (
    present_appointment,
    present_appointment_history,
)
from app.api.dependencies import Principal, require_permission, verify_csrf
from app.core.exceptions import ApiError
from app.db.session import get_db
from app.models import Appointment, MedicationReview, ScheduleAdditionalSlot
from app.schemas.appointment import (
    AppointmentChangeRequest,
    AppointmentCreateRequest,
    AppointmentHistoryEventResponse,
    AppointmentListResponse,
    AppointmentResponse,
    AppointmentStateChangeRequest,
    AvailableSlotResponse,
    BookingBucket,
    BookingOrigin,
    ExceptionConfirmRequest,
    ProcedureCode,
    ProcedureSet,
    ScheduleAvailabilityResponse,
)
from app.schemas.common import ErrorResponse
from app.services import appointments as appointment_service

router = APIRouter(prefix="/appointments", tags=["appointments"])
appointment_reader = require_permission("appointment.read")
appointment_creator = require_permission("appointment.create")
appointment_updater = require_permission("appointment.update")
appointment_canceller = require_permission("appointment.cancel")
no_show_recorder = require_permission("appointment.no_show")
exception_confirmer = require_permission("schedule_override.approve")

MUTATION_RESPONSES: dict[int | str, dict[str, object]] = {
    403: {"model": ErrorResponse},
    404: {"model": ErrorResponse},
    409: {"model": ErrorResponse},
    422: {"model": ErrorResponse},
}


def _concurrent_time_conflict() -> ApiError:
    return ApiError(
        status_code=409,
        code="TIME_CONFLICT",
        message="다른 사용자가 같은 시간에 예약을 먼저 저장했습니다.",
    )


@router.get(
    "/availability",
    response_model=ScheduleAvailabilityResponse,
    response_model_exclude_none=True,
)
def get_availability(
    service_date: date,
    procedures: list[ProcedureCode] = Query(min_length=1, max_length=2),
    booking_bucket: BookingBucket = "STANDARD_MORNING",
    procedure_set: ProcedureSet | None = None,
    booking_origin: BookingOrigin = "ADVANCE",
    additional_slot_id: UUID | None = None,
    exclude_appointment_id: UUID | None = None,
    _: Principal = Depends(appointment_reader),
    db: Session = Depends(get_db),
) -> ScheduleAvailabilityResponse:
    procedure_codes = set(procedures)
    if len(procedure_codes) != len(procedures):
        raise ApiError(
            status_code=422,
            code="PROCEDURE_DUPLICATE",
            message="같은 검사를 중복 선택할 수 없습니다.",
        )
    duration, slots, policy_version = appointment_service.available_slots(
        db,
        service_date=service_date,
        procedure_codes=procedure_codes,
        procedure_set=procedure_set,
        booking_bucket=booking_bucket,
        booking_origin=booking_origin,
        additional_slot_id=additional_slot_id,
        exclude_appointment_id=exclude_appointment_id,
    )
    additional_slots_by_start: dict[object, ScheduleAdditionalSlot] = {}
    if booking_bucket == "SAME_DAY_EXTENSION":
        additional_slots_by_start = {
            item.start_time: item
            for item in db.scalars(
                select(ScheduleAdditionalSlot).where(
                    ScheduleAdditionalSlot.service_date == service_date,
                    ScheduleAdditionalSlot.status == "APPROVED",
                )
            ).all()
        }
    return ScheduleAvailabilityResponse(
        service_date=service_date,
        booking_bucket=booking_bucket,
        duration_minutes=duration,
        procedure_set=(procedure_set or "SET_60") if procedure_codes == {"UPPER", "COLON"} else None,
        schedule_policy_version=policy_version,
        slots=[
            AvailableSlotResponse(
                start_time=start,
                end_time=end,
                slot_type=(
                    "SAME_DAY_EXTENSION"
                    if booking_bucket == "SAME_DAY_EXTENSION"
                    else None
                ),
                additional_slot_id=(
                    additional_slots_by_start[start].id
                    if start in additional_slots_by_start
                    else None
                ),
            )
            for start, end in slots
        ],
    )


@router.get("", response_model=AppointmentListResponse)
def get_appointments(
    start_date: date,
    end_date: date,
    _: Principal = Depends(appointment_reader),
    db: Session = Depends(get_db),
) -> AppointmentListResponse:
    appointments = appointment_service.list_appointments(
        db,
        start_date=start_date,
        end_date=end_date,
    )
    return AppointmentListResponse(
        items=[present_appointment(item) for item in appointments],
        total=len(appointments),
    )


@router.get("/{appointment_id}", response_model=AppointmentResponse)
def get_appointment(
    appointment_id: UUID,
    _: Principal = Depends(appointment_reader),
    db: Session = Depends(get_db),
) -> AppointmentResponse:
    appointment = db.get(
        Appointment,
        appointment_id,
        options=(
            selectinload(Appointment.procedures),
            selectinload(Appointment.resource),
            selectinload(Appointment.patient),
            selectinload(Appointment.verifications),
            selectinload(Appointment.medication_review).selectinload(
                MedicationReview.items
            ),
        ),
    )
    if appointment is None:
        raise ApiError(
            status_code=404,
            code="APPOINTMENT_NOT_FOUND",
            message="예약을 찾을 수 없습니다.",
        )
    return present_appointment(appointment)


@router.get(
    "/{appointment_id}/history",
    response_model=list[AppointmentHistoryEventResponse],
)
def get_appointment_history(
    appointment_id: UUID,
    _: Principal = Depends(appointment_reader),
    db: Session = Depends(get_db),
) -> list[AppointmentHistoryEventResponse]:
    return [
        present_appointment_history(event)
        for event in appointment_service.list_appointment_history(
            db, appointment_id
        )
    ]


@router.post(
    "",
    response_model=AppointmentResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_csrf)],
    responses=MUTATION_RESPONSES,
)
def create_appointment(
    payload: AppointmentCreateRequest,
    principal: Principal = Depends(appointment_creator),
    db: Session = Depends(get_db),
) -> AppointmentResponse:
    try:
        appointment = appointment_service.create_appointment(
            db,
            patient_id=payload.patient_id,
            service_date=payload.service_date,
            start_time=payload.start_time,
            care_type=payload.care_type,
            booking_bucket=payload.booking_bucket,
            booking_origin=payload.booking_origin,
            procedures=payload.procedures,
            procedure_set=payload.procedure_set,
            exception_reason=payload.exception_reason,
            additional_slot_id=payload.additional_slot_id,
            same_day_reason=payload.same_day_reason,
            same_day_preparation_confirmed=payload.same_day_preparation_confirmed,
            same_day_clinician_confirmed=payload.same_day_clinician_confirmed,
            same_day_escort_confirmed=payload.same_day_escort_confirmed,
            actor_user_id=principal.user.id,
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise _concurrent_time_conflict() from exc
    return present_appointment(appointment)


@router.patch(
    "/{appointment_id}",
    response_model=AppointmentResponse,
    dependencies=[Depends(verify_csrf)],
    responses=MUTATION_RESPONSES,
)
def change_appointment(
    appointment_id: UUID,
    payload: AppointmentChangeRequest,
    principal: Principal = Depends(appointment_updater),
    db: Session = Depends(get_db),
) -> AppointmentResponse:
    try:
        appointment = appointment_service.change_appointment(
            db,
            appointment_id=appointment_id,
            row_version=payload.row_version,
            reason=payload.reason,
            actor_user_id=principal.user.id,
            service_date=payload.service_date,
            start_time=payload.start_time,
            care_type=payload.care_type,
            procedures=payload.procedures,
            procedure_set=payload.procedure_set,
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise _concurrent_time_conflict() from exc
    return present_appointment(appointment)


@router.post(
    "/{appointment_id}/cancel",
    response_model=AppointmentResponse,
    dependencies=[Depends(verify_csrf)],
    responses=MUTATION_RESPONSES,
)
def cancel_appointment(
    appointment_id: UUID,
    payload: AppointmentStateChangeRequest,
    principal: Principal = Depends(appointment_canceller),
    db: Session = Depends(get_db),
) -> AppointmentResponse:
    appointment = appointment_service.cancel_appointment(
        db,
        appointment_id=appointment_id,
        row_version=payload.row_version,
        reason=payload.reason,
        actor_user_id=principal.user.id,
    )
    db.commit()
    return present_appointment(appointment)


@router.post(
    "/{appointment_id}/no-show",
    response_model=AppointmentResponse,
    dependencies=[Depends(verify_csrf)],
    responses=MUTATION_RESPONSES,
)
def record_no_show(
    appointment_id: UUID,
    payload: AppointmentStateChangeRequest,
    principal: Principal = Depends(no_show_recorder),
    db: Session = Depends(get_db),
) -> AppointmentResponse:
    appointment = appointment_service.record_no_show(
        db,
        appointment_id=appointment_id,
        row_version=payload.row_version,
        reason=payload.reason,
        actor_user_id=principal.user.id,
    )
    db.commit()
    return present_appointment(appointment)


@router.post(
    "/{appointment_id}/confirm-exception",
    response_model=AppointmentResponse,
    dependencies=[Depends(verify_csrf)],
    responses=MUTATION_RESPONSES,
)
def confirm_afternoon_exception(
    appointment_id: UUID,
    payload: ExceptionConfirmRequest,
    principal: Principal = Depends(exception_confirmer),
    db: Session = Depends(get_db),
) -> AppointmentResponse:
    appointment = appointment_service.confirm_afternoon_exception(
        db,
        appointment_id=appointment_id,
        row_version=payload.row_version,
        memo=payload.memo,
        actor_user_id=principal.user.id,
    )
    db.commit()
    return present_appointment(appointment)
