from __future__ import annotations

from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.api.appointment_presenters import present_appointment
from app.api.dependencies import Principal, require_permission, verify_csrf
from app.core.exceptions import ApiError
from app.db.session import get_db
from app.models import Appointment
from app.schemas.appointment import (
    AppointmentCreateRequest,
    AppointmentListResponse,
    AppointmentResponse,
    AvailableSlotResponse,
    BookingBucket,
    ProcedureCode,
    ProcedureSet,
    ScheduleAvailabilityResponse,
)
from app.services import appointments as appointment_service


router = APIRouter(prefix="/appointments", tags=["appointments"])
appointment_reader = require_permission("appointment.read")
appointment_creator = require_permission("appointment.create")


@router.get("/availability", response_model=ScheduleAvailabilityResponse)
def get_availability(
    service_date: date,
    procedures: list[ProcedureCode] = Query(min_length=1, max_length=2),
    booking_bucket: BookingBucket = "STANDARD_MORNING",
    procedure_set: ProcedureSet | None = None,
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
    duration, slots = appointment_service.available_slots(
        db,
        service_date=service_date,
        procedure_codes=procedure_codes,
        procedure_set=procedure_set,
        booking_bucket=booking_bucket,
    )
    return ScheduleAvailabilityResponse(
        service_date=service_date,
        booking_bucket=booking_bucket,
        duration_minutes=duration,
        procedure_set=(procedure_set or "SET_60") if procedure_codes == {"UPPER", "COLON"} else None,
        schedule_policy_version=appointment_service.BASE_POLICY_VERSION,
        slots=[
            AvailableSlotResponse(start_time=start, end_time=end)
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
        ),
    )
    if appointment is None:
        raise ApiError(
            status_code=404,
            code="APPOINTMENT_NOT_FOUND",
            message="예약을 찾을 수 없습니다.",
        )
    return present_appointment(appointment)


@router.post(
    "",
    response_model=AppointmentResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_csrf)],
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
            procedures=payload.procedures,
            procedure_set=payload.procedure_set,
            actor_user_id=principal.user.id,
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ApiError(
            status_code=409,
            code="TIME_CONFLICT",
            message="다른 사용자가 같은 시간에 예약을 먼저 저장했습니다.",
        ) from exc
    return present_appointment(appointment)
