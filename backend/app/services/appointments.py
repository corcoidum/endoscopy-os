from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo
from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.orm import Session, selectinload

from app.core.exceptions import ApiError
from app.models import (
    Appointment,
    AppointmentHistoryEvent,
    AppointmentProcedure,
    Patient,
    ScheduleResource,
)
from app.schemas.appointment import (
    AppointmentProcedureInput,
    BookingBucket,
    CareType,
    ProcedureCode,
)


SEOUL = ZoneInfo("Asia/Seoul")
DEFAULT_RESOURCE_CODE = "ENDOSCOPY_MAIN"
BASE_POLICY_VERSION = "BASE-2026-07-30"
SLOT_MINUTES = 30


@dataclass(frozen=True)
class ScheduleRule:
    start_minute: int
    end_minute: int
    upper_capacity: int | None
    colon_capacity: int | None


@dataclass(frozen=True)
class ScheduleContext:
    appointments: list[Appointment]
    upper_count: int
    colon_count: int


def procedure_duration(procedure_codes: set[ProcedureCode]) -> int:
    if not procedure_codes:
        raise ApiError(
            status_code=422,
            code="PROCEDURE_REQUIRED",
            message="위 또는 대장내시경을 하나 이상 선택해 주세요.",
        )
    return 30 if procedure_codes == {"UPPER"} else 60


def base_rule_for(service_date: date) -> ScheduleRule:
    weekday = service_date.isoweekday()
    if weekday == 7:
        raise ApiError(
            status_code=409,
            code="SCHEDULE_CLOSED",
            message="일요일은 기본 휴진일입니다.",
        )
    if weekday in {3, 6}:
        return ScheduleRule(9 * 60, 11 * 60, None, None)
    return ScheduleRule(9 * 60, 12 * 60, 5, 3)


def _time_to_minutes(value: time) -> int:
    return value.hour * 60 + value.minute


def _minutes_to_time(value: int) -> time:
    return time(hour=value // 60, minute=value % 60)


def _procedure_codes(appointment: Appointment) -> set[ProcedureCode]:
    return {
        procedure.procedure_code  # type: ignore[misc]
        for procedure in appointment.procedures
    }


def _load_context(db: Session, service_date: date) -> ScheduleContext:
    appointments = list(
        db.scalars(
            select(Appointment)
            .where(
                Appointment.service_date == service_date,
                Appointment.occupies_slot.is_(True),
                Appointment.booking_bucket == "STANDARD_MORNING",
            )
            .options(selectinload(Appointment.procedures))
            .order_by(Appointment.scheduled_start_at)
        ).all()
    )
    upper_count = sum("UPPER" in _procedure_codes(item) for item in appointments)
    colon_count = sum("COLON" in _procedure_codes(item) for item in appointments)
    return ScheduleContext(appointments, upper_count, colon_count)


def _overlaps(
    candidate_start: int,
    candidate_end: int,
    appointment: Appointment,
) -> bool:
    existing_start = (
        appointment.scheduled_start_at.hour * 60
        + appointment.scheduled_start_at.minute
    )
    existing_end = (
        appointment.scheduled_end_at.hour * 60
        + appointment.scheduled_end_at.minute
    )
    return candidate_start < existing_end and existing_start < candidate_end


def validate_standard_morning(
    *,
    service_date: date,
    start_time: time,
    procedure_codes: set[ProcedureCode],
    context: ScheduleContext,
) -> int:
    rule = base_rule_for(service_date)
    duration = procedure_duration(procedure_codes)
    start_minute = _time_to_minutes(start_time)
    end_minute = start_minute + duration

    if start_time.second or start_time.microsecond or start_minute % SLOT_MINUTES:
        raise ApiError(
            status_code=422,
            code="TIME_GRID_INVALID",
            message="예약 시작시각은 30분 단위여야 합니다.",
        )
    if start_minute < rule.start_minute or end_minute > rule.end_minute:
        raise ApiError(
            status_code=409,
            code="END_TIME_EXCEEDED",
            message="검사가 오전 운영시간 안에 종료되지 않습니다.",
        )
    if any(
        _overlaps(start_minute, end_minute, appointment)
        for appointment in context.appointments
    ):
        raise ApiError(
            status_code=409,
            code="TIME_CONFLICT",
            message="선택한 시간이 기존 예약과 겹칩니다.",
        )

    candidate_upper = context.upper_count + int("UPPER" in procedure_codes)
    candidate_colon = context.colon_count + int("COLON" in procedure_codes)
    if (
        rule.upper_capacity is not None
        and candidate_upper > rule.upper_capacity
    ) or (
        rule.colon_capacity is not None
        and candidate_colon > rule.colon_capacity
    ):
        raise ApiError(
            status_code=409,
            code="CAPACITY_EXCEEDED",
            message="선택한 날짜의 검사 종류별 수용량을 초과합니다.",
        )
    return duration


def get_default_resource(db: Session) -> ScheduleResource:
    resource = db.scalar(
        select(ScheduleResource).where(
            ScheduleResource.code == DEFAULT_RESOURCE_CODE,
            ScheduleResource.is_active.is_(True),
        )
    )
    if resource is None:
        raise ApiError(
            status_code=503,
            code="SCHEDULE_RESOURCE_NOT_CONFIGURED",
            message="내시경 일정 Resource 초기화를 확인해 주세요.",
        )
    return resource


def _lock_schedule_date(db: Session, service_date: date) -> None:
    # PostgreSQL에서는 같은 날짜의 Capacity 계산과 저장을 직렬화한다.
    if db.get_bind().dialect.name == "postgresql":
        db.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:scope))"),
            {"scope": f"schedule:{service_date.isoformat()}"},
        )


def available_slots(
    db: Session,
    *,
    service_date: date,
    procedure_codes: set[ProcedureCode],
    booking_bucket: BookingBucket,
) -> tuple[int, list[tuple[time, time]]]:
    if booking_bucket != "STANDARD_MORNING":
        raise ApiError(
            status_code=409,
            code="AFTERNOON_POLICY_NOT_IMPLEMENTED",
            message="14:00 예외 승인 규칙은 Sprint 3B에서 제공됩니다.",
        )
    rule = base_rule_for(service_date)
    duration = procedure_duration(procedure_codes)
    context = _load_context(db, service_date)
    slots: list[tuple[time, time]] = []
    for start_minute in range(
        rule.start_minute,
        rule.end_minute,
        SLOT_MINUTES,
    ):
        candidate_time = _minutes_to_time(start_minute)
        try:
            validate_standard_morning(
                service_date=service_date,
                start_time=candidate_time,
                procedure_codes=procedure_codes,
                context=context,
            )
        except ApiError:
            continue
        slots.append(
            (candidate_time, _minutes_to_time(start_minute + duration))
        )
    return duration, slots


def create_appointment(
    db: Session,
    *,
    patient_id: UUID,
    service_date: date,
    start_time: time,
    care_type: CareType,
    booking_bucket: BookingBucket,
    procedures: list[AppointmentProcedureInput],
    actor_user_id: UUID,
) -> Appointment:
    if booking_bucket != "STANDARD_MORNING":
        raise ApiError(
            status_code=409,
            code="AFTERNOON_POLICY_NOT_IMPLEMENTED",
            message="14:00 예외 승인 규칙은 Sprint 3B에서 제공됩니다.",
        )
    patient = db.get(Patient, patient_id)
    if patient is None:
        raise ApiError(
            status_code=404,
            code="PATIENT_NOT_FOUND",
            message="환자정보를 찾을 수 없습니다.",
        )
    if not patient.is_active:
        raise ApiError(
            status_code=409,
            code="PATIENT_INACTIVE",
            message="비활성 환자에게 새 예약을 등록할 수 없습니다.",
        )

    resource = get_default_resource(db)
    _lock_schedule_date(db, service_date)
    context = _load_context(db, service_date)
    codes = {item.procedure_code for item in procedures}
    duration = validate_standard_morning(
        service_date=service_date,
        start_time=start_time,
        procedure_codes=codes,
        context=context,
    )
    starts_at = datetime.combine(service_date, start_time, tzinfo=SEOUL)
    ends_at = starts_at + timedelta(minutes=duration)
    appointment = Appointment(
        patient_id=patient.id,
        resource_id=resource.id,
        service_date=service_date,
        scheduled_start_at=starts_at,
        scheduled_end_at=ends_at,
        booking_bucket=booking_bucket,
        care_type=care_type,
        workflow_state="BOOKED",
        occupies_slot=True,
        schedule_policy_version=BASE_POLICY_VERSION,
        created_by_user_id=actor_user_id,
        updated_by_user_id=actor_user_id,
        procedures=[
            AppointmentProcedure(
                procedure_code=item.procedure_code,
                sedation_mode=item.sedation_mode,
            )
            for item in procedures
        ],
    )
    db.add(appointment)
    db.flush()
    snapshot = appointment_snapshot(appointment)
    db.add(
        AppointmentHistoryEvent(
            appointment_id=appointment.id,
            event_type="CREATED",
            changed_fields=sorted(snapshot),
            before_values=None,
            after_values=snapshot,
            reason="신규 예약 등록",
            actor_user_id=actor_user_id,
        )
    )
    db.flush()
    return appointment


def appointment_snapshot(appointment: Appointment) -> dict[str, object]:
    return {
        "patient_id": str(appointment.patient_id),
        "service_date": appointment.service_date.isoformat(),
        "start_time": appointment.scheduled_start_at.strftime("%H:%M"),
        "end_time": appointment.scheduled_end_at.strftime("%H:%M"),
        "care_type": appointment.care_type,
        "booking_bucket": appointment.booking_bucket,
        "workflow_state": appointment.workflow_state,
        "procedures": [
            {
                "procedure_code": item.procedure_code,
                "sedation_mode": item.sedation_mode,
            }
            for item in appointment.procedures
        ],
    }


def list_appointments(
    db: Session,
    *,
    start_date: date,
    end_date: date,
) -> list[Appointment]:
    if end_date < start_date or (end_date - start_date).days > 31:
        raise ApiError(
            status_code=422,
            code="DATE_RANGE_INVALID",
            message="조회 기간은 시작일 이후 최대 31일까지 지정할 수 있습니다.",
        )
    return list(
        db.scalars(
            select(Appointment)
            .where(
                Appointment.service_date >= start_date,
                Appointment.service_date <= end_date,
            )
            .options(
                selectinload(Appointment.procedures),
                selectinload(Appointment.resource),
                selectinload(Appointment.patient),
            )
            .order_by(
                Appointment.service_date,
                Appointment.scheduled_start_at,
            )
        ).all()
    )
