from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time, timedelta
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
    ScheduleAdditionalSlot,
    ScheduleDateOverride,
    ScheduleResource,
)
from app.schemas.appointment import (
    AppointmentProcedureInput,
    BookingBucket,
    BookingOrigin,
    CareType,
    ProcedureCode,
    ProcedureSet,
)


SEOUL = ZoneInfo("Asia/Seoul")
DEFAULT_RESOURCE_CODE = "ENDOSCOPY_MAIN"
BASE_POLICY_VERSION = "BASE-2026-07-30"
SLOT_MINUTES = 30
# 월간 달력은 앞뒤 주를 포함해 최대 6주(42일) Grid를 그리므로 한 번에 조회할 수 있어야 한다.
MAX_APPOINTMENT_RANGE_DAYS = 42
AFTERNOON_START = time(14, 0)
AFTERNOON_PATIENT_CAPACITY = 1
ACTIVE_WORKFLOW_STATE = "BOOKED"
_OVERRIDE_VERSION_CODES = {
    "CLOSED": "C",
    "OPERATING_HOURS": "H",
    "CAPACITY": "Q",
    "AFTERNOON_ALLOW": "A",
}


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
    bucket_appointments: list[Appointment] = field(default_factory=list)


@dataclass(frozen=True)
class ResolvedDayPolicy:
    """DEC-03 우선순위로 요일 기본 규칙과 승인된 날짜별 Rule을 합친 결과."""

    service_date: date
    closed: bool
    morning: ScheduleRule | None
    afternoon_allowed: bool
    policy_version: str


@dataclass(frozen=True)
class PolicyConflict:
    appointment: Appointment
    issue: str


def procedure_duration(
    procedure_codes: set[ProcedureCode],
    procedure_set: ProcedureSet | None = None,
) -> int:
    if not procedure_codes:
        raise ApiError(
            status_code=422,
            code="PROCEDURE_REQUIRED",
            message="위 또는 대장내시경을 하나 이상 선택해 주세요.",
        )
    if procedure_set is not None and procedure_codes != {"UPPER", "COLON"}:
        raise ApiError(
            status_code=422,
            code="PROCEDURE_SET_INVALID",
            message="세트60·세트90은 위·대장 동시검사에서만 선택할 수 있습니다.",
        )
    if procedure_codes == {"UPPER"}:
        return 30
    if procedure_codes == {"COLON"}:
        return 60
    return 90 if procedure_set == "SET_90" else 60


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


def time_to_minutes(value: time) -> int:
    return value.hour * 60 + value.minute


def minutes_to_time(value: int) -> time:
    return time(hour=value // 60, minute=value % 60)


def to_seoul(value: datetime) -> datetime:
    """DB Session Timezone과 무관하게 예약 시각을 서울 기준 벽시계로 맞춘다.

    SQLite는 저장 시 Offset을 버리고 서울 벽시계 값을 그대로 돌려주며,
    PostgreSQL은 Session Timezone(UTC 등) 기준으로 돌려줄 수 있다.
    """

    if value.tzinfo is None:
        return value.replace(tzinfo=SEOUL)
    return value.astimezone(SEOUL)


def today_in_seoul(now: datetime | None = None) -> date:
    """Server Timezone과 무관하게 서울 기준 오늘 날짜를 돌려준다."""

    return (now or datetime.now(UTC)).astimezone(SEOUL).date()


def _reject_past_service_date(
    service_date: date, *, now: datetime | None = None
) -> None:
    """지난 날짜로의 예약 등록·이동을 막는다.

    연도를 잘못 입력하면 일정 화면에 영원히 보이지 않는 예약이 생기고, 시작시각이
    이미 지났으므로 곧바로 No-show로도 기록할 수 있다. 이미 지난 예약의 검사 구성
    같은 사후 정정은 막지 않고, 새로 지난 날짜로 만드는 경우만 차단한다.
    """

    today = today_in_seoul(now)
    if service_date < today:
        raise ApiError(
            status_code=422,
            code="SERVICE_DATE_IN_PAST",
            message=(
                f"지난 날짜({service_date.isoformat()})로는 예약할 수 없습니다. "
                f"오늘({today.isoformat()}) 이후 날짜를 선택해 주세요."
            ),
        )


def _procedure_codes(appointment: Appointment) -> set[ProcedureCode]:
    return {
        procedure.procedure_code  # type: ignore[misc]
        for procedure in appointment.procedures
    }


def _schedule_closed(service_date: date) -> ApiError:
    return ApiError(
        status_code=409,
        code="SCHEDULE_CLOSED",
        message=(
            "일요일은 기본 휴진일입니다."
            if service_date.isoweekday() == 7
            else "선택한 날짜는 휴진일로 지정되었습니다."
        ),
    )


def _policy_version(overrides: list[ScheduleDateOverride]) -> str:
    if not overrides:
        return BASE_POLICY_VERSION
    suffix = ",".join(
        f"{_OVERRIDE_VERSION_CODES[item.rule_type]}{item.id.hex[:6]}"
        for item in overrides
    )
    return f"{BASE_POLICY_VERSION}+{suffix}"[:80]


def resolve_day_policy(db: Session, service_date: date) -> ResolvedDayPolicy:
    overrides = list(
        db.scalars(
            select(ScheduleDateOverride)
            .where(
                ScheduleDateOverride.service_date == service_date,
                ScheduleDateOverride.status == "APPROVED",
            )
            .order_by(ScheduleDateOverride.rule_type, ScheduleDateOverride.id)
        ).all()
    )
    by_type = {item.rule_type: item for item in overrides}
    version = _policy_version(overrides)

    # 1. 휴진은 다른 모든 날짜별 Rule보다 우선한다.
    if service_date.isoweekday() == 7 or "CLOSED" in by_type:
        return ResolvedDayPolicy(service_date, True, None, False, version)

    base = base_rule_for(service_date)
    start_minute, end_minute = base.start_minute, base.end_minute
    upper_capacity, colon_capacity = base.upper_capacity, base.colon_capacity

    # 3. 운영시간 변경: 마지막 시작시각은 종료시각−점유시간으로 자동 계산된다(DEC-19).
    hours = by_type.get("OPERATING_HOURS")
    if hours is not None and hours.override_start_time and hours.override_end_time:
        start_minute = time_to_minutes(hours.override_start_time)
        end_minute = time_to_minutes(hours.override_end_time)

    # 4. 수용량 변경: 입력한 항목만 요일 기본값을 대체한다.
    capacity = by_type.get("CAPACITY")
    if capacity is not None:
        if capacity.override_upper_capacity is not None:
            upper_capacity = capacity.override_upper_capacity
        if capacity.override_colon_capacity is not None:
            colon_capacity = capacity.override_colon_capacity

    return ResolvedDayPolicy(
        service_date=service_date,
        closed=False,
        morning=ScheduleRule(
            start_minute, end_minute, upper_capacity, colon_capacity
        ),
        afternoon_allowed="AFTERNOON_ALLOW" in by_type,
        policy_version=version,
    )


def _load_context(
    db: Session,
    service_date: date,
    *,
    booking_bucket: BookingBucket = "STANDARD_MORNING",
    exclude_appointment_id: UUID | None = None,
) -> ScheduleContext:
    statement = (
        select(Appointment)
        .where(
            Appointment.service_date == service_date,
            Appointment.occupies_slot.is_(True),
        )
        .options(selectinload(Appointment.procedures))
        .order_by(Appointment.scheduled_start_at)
    )
    if exclude_appointment_id is not None:
        statement = statement.where(Appointment.id != exclude_appointment_id)
    appointments = list(db.scalars(statement).all())
    bucket_appointments = [
        item for item in appointments if item.booking_bucket == booking_bucket
    ]
    upper_count = sum(
        "UPPER" in _procedure_codes(item) for item in bucket_appointments
    )
    colon_count = sum(
        "COLON" in _procedure_codes(item) for item in bucket_appointments
    )
    return ScheduleContext(
        appointments=appointments,
        bucket_appointments=bucket_appointments,
        upper_count=upper_count,
        colon_count=colon_count,
    )


def intervals_overlap(
    start_minute: int,
    end_minute: int,
    other_start_minute: int,
    other_end_minute: int,
) -> bool:
    """[start, end) 두 구간이 겹치는지 분 단위로 판정한다."""

    return start_minute < other_end_minute and other_start_minute < end_minute


def _overlaps(
    candidate_start: int,
    candidate_end: int,
    appointment: Appointment,
) -> bool:
    return intervals_overlap(
        candidate_start,
        candidate_end,
        time_to_minutes(to_seoul(appointment.scheduled_start_at).time()),
        time_to_minutes(to_seoul(appointment.scheduled_end_at).time()),
    )


def validate_standard_morning(
    *,
    service_date: date,
    start_time: time,
    procedure_codes: set[ProcedureCode],
    context: ScheduleContext,
    procedure_set: ProcedureSet | None = None,
    rule: ScheduleRule | None = None,
) -> int:
    rule = rule or base_rule_for(service_date)
    duration = procedure_duration(procedure_codes, procedure_set)
    start_minute = time_to_minutes(start_time)
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


def validate_afternoon_exception(
    *,
    start_time: time,
    procedure_codes: set[ProcedureCode],
    policy: ResolvedDayPolicy,
    context: ScheduleContext,
    procedure_set: ProcedureSet | None = None,
) -> int:
    if policy.closed:
        raise _schedule_closed(policy.service_date)
    if not policy.afternoon_allowed:
        raise ApiError(
            status_code=409,
            code="AFTERNOON_NOT_ALLOWED",
            message="선택한 날짜는 14:00 오후 예외가 허용되지 않았습니다.",
        )
    duration = procedure_duration(procedure_codes, procedure_set)
    if start_time != AFTERNOON_START:
        raise ApiError(
            status_code=422,
            code="AFTERNOON_START_TIME_INVALID",
            message="오후 예외 예약은 14:00에 시작합니다.",
        )
    # 확인 대기 예약도 오후 Capacity를 점유한다.
    if len(context.bucket_appointments) >= AFTERNOON_PATIENT_CAPACITY:
        raise ApiError(
            status_code=409,
            code="AFTERNOON_LIMIT_EXCEEDED",
            message="선택한 날짜에는 이미 오후 예외 예약이 있습니다.",
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


def lock_schedule_date(db: Session, service_date: date) -> None:
    # PostgreSQL에서는 같은 날짜의 Capacity 계산과 저장을 직렬화한다.
    if db.get_bind().dialect.name == "postgresql":
        db.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:scope))"),
            {"scope": f"schedule:{service_date.isoformat()}"},
        )


def _validate_candidate(
    db: Session,
    *,
    service_date: date,
    start_time: time,
    booking_bucket: BookingBucket,
    procedure_codes: set[ProcedureCode],
    procedure_set: ProcedureSet | None,
    additional_slot_id: UUID | None = None,
    exclude_appointment_id: UUID | None = None,
) -> tuple[int, ResolvedDayPolicy]:
    policy = resolve_day_policy(db, service_date)
    if policy.closed:
        raise _schedule_closed(service_date)
    context = _load_context(
        db,
        service_date,
        booking_bucket=booking_bucket,
        exclude_appointment_id=exclude_appointment_id,
    )
    if booking_bucket == "AFTERNOON_EXCEPTION":
        duration = validate_afternoon_exception(
            start_time=start_time,
            procedure_codes=procedure_codes,
            procedure_set=procedure_set,
            policy=policy,
            context=context,
        )
    elif booking_bucket == "SAME_DAY_EXTENSION":
        if additional_slot_id is None:
            raise ApiError(
                status_code=422,
                code="ADDITIONAL_SLOT_REQUIRED",
                message="당일 연장 예약에는 승인된 연장 슬롯이 필요합니다.",
            )
        if procedure_codes != {"UPPER"}:
            raise ApiError(
                status_code=422,
                code="SAME_DAY_UPPER_ONLY",
                message="당일 추가 검사는 위내시경만 등록할 수 있습니다.",
            )
        slot = db.scalar(
            select(ScheduleAdditionalSlot)
            .where(ScheduleAdditionalSlot.id == additional_slot_id)
            .with_for_update()
        )
        if (
            slot is None
            or slot.status != "APPROVED"
            or slot.service_date != service_date
            or slot.start_time != start_time
        ):
            raise ApiError(
                status_code=409,
                code="ADDITIONAL_SLOT_NOT_AVAILABLE",
                message="승인된 당일 연장 슬롯을 사용할 수 없습니다.",
            )
        # 취소·No-show로 Slot을 놓아준 예약은 Slot을 계속 붙잡지 않는다.
        already_used = db.scalar(
            select(Appointment.id).where(
                Appointment.additional_slot_id == additional_slot_id,
                Appointment.occupies_slot.is_(True),
                Appointment.id != exclude_appointment_id,
            )
        )
        if already_used is not None:
            raise ApiError(
                status_code=409,
                code="ADDITIONAL_SLOT_ALREADY_USED",
                message="이미 예약에 사용된 당일 연장 슬롯입니다.",
            )
        duration = procedure_duration(procedure_codes, procedure_set)
        if time_to_minutes(slot.end_time) - time_to_minutes(slot.start_time) != duration:
            raise ApiError(
                status_code=409,
                code="ADDITIONAL_SLOT_DURATION_INVALID",
                message="당일 연장 슬롯은 위내시경 30분과 일치해야 합니다.",
            )
        start_minute = time_to_minutes(start_time)
        if any(
            _overlaps(start_minute, start_minute + duration, appointment)
            for appointment in context.appointments
        ):
            raise ApiError(
                status_code=409,
                code="TIME_CONFLICT",
                message="선택한 시간이 기존 예약과 겹칩니다.",
            )
    else:
        duration = validate_standard_morning(
            service_date=service_date,
            start_time=start_time,
            procedure_codes=procedure_codes,
            procedure_set=procedure_set,
            context=context,
            rule=policy.morning,
        )
    return duration, policy


def available_slots(
    db: Session,
    *,
    service_date: date,
    procedure_codes: set[ProcedureCode],
    booking_bucket: BookingBucket,
    booking_origin: BookingOrigin = "ADVANCE",
    procedure_set: ProcedureSet | None = None,
    additional_slot_id: UUID | None = None,
    now: datetime | None = None,
) -> tuple[int, list[tuple[time, time]], str]:
    local_now = (now or datetime.now(UTC)).astimezone(SEOUL)
    if booking_origin == "SAME_DAY":
        if service_date != local_now.date():
            raise ApiError(
                status_code=422,
                code="SAME_DAY_DATE_REQUIRED",
                message="당일 위내시경은 서울 기준 오늘 날짜에만 조회할 수 있습니다.",
            )
        if procedure_codes != {"UPPER"}:
            raise ApiError(
                status_code=422,
                code="SAME_DAY_UPPER_ONLY",
                message="당일 추가 검사는 위내시경만 등록할 수 있습니다.",
            )
    policy = resolve_day_policy(db, service_date)
    if policy.closed or policy.morning is None:
        raise _schedule_closed(service_date)
    duration = procedure_duration(procedure_codes, procedure_set)
    context = _load_context(db, service_date, booking_bucket=booking_bucket)

    if booking_bucket == "SAME_DAY_EXTENSION":
        if procedure_codes != {"UPPER"}:
            raise ApiError(
                status_code=422,
                code="SAME_DAY_UPPER_ONLY",
                message="당일 추가 검사는 위내시경만 등록할 수 있습니다.",
            )
        statement = select(ScheduleAdditionalSlot).where(
            ScheduleAdditionalSlot.service_date == service_date,
            ScheduleAdditionalSlot.status == "APPROVED",
        )
        if additional_slot_id is not None:
            statement = statement.where(ScheduleAdditionalSlot.id == additional_slot_id)
        approved_slots = list(
            db.scalars(statement.order_by(ScheduleAdditionalSlot.start_time)).all()
        )
        used_slot_ids = set(
            db.scalars(
                select(Appointment.additional_slot_id).where(
                    Appointment.additional_slot_id.is_not(None),
                    Appointment.service_date == service_date,
                    Appointment.occupies_slot.is_(True),
                )
            ).all()
        )
        slots: list[tuple[time, time]] = []
        for slot in approved_slots:
            if slot.id in used_slot_ids:
                continue
            start_minute = time_to_minutes(slot.start_time)
            if (
                datetime.combine(service_date, slot.start_time, tzinfo=SEOUL) > local_now
                and not any(
                _overlaps(start_minute, start_minute + duration, appointment)
                for appointment in context.appointments
                )
            ):
                slots.append((slot.start_time, slot.end_time))
        return duration, slots, policy.policy_version

    if booking_bucket == "AFTERNOON_EXCEPTION":
        try:
            validate_afternoon_exception(
                start_time=AFTERNOON_START,
                procedure_codes=procedure_codes,
                procedure_set=procedure_set,
                policy=policy,
                context=context,
            )
        except ApiError as exc:
            if exc.code == "AFTERNOON_NOT_ALLOWED":
                raise
            return duration, [], policy.policy_version
        afternoon_start = time_to_minutes(AFTERNOON_START)
        return (
            duration,
            [(AFTERNOON_START, minutes_to_time(afternoon_start + duration))],
            policy.policy_version,
        )

    slots: list[tuple[time, time]] = []
    for start_minute in range(
        policy.morning.start_minute,
        policy.morning.end_minute,
        SLOT_MINUTES,
    ):
        candidate_time = minutes_to_time(start_minute)
        if (
            booking_origin == "SAME_DAY"
            and datetime.combine(service_date, candidate_time, tzinfo=SEOUL) <= local_now
        ):
            continue
        try:
            validate_standard_morning(
                service_date=service_date,
                start_time=candidate_time,
                procedure_codes=procedure_codes,
                procedure_set=procedure_set,
                context=context,
                rule=policy.morning,
            )
        except ApiError:
            continue
        slots.append(
            (candidate_time, minutes_to_time(start_minute + duration))
        )
    return duration, slots, policy.policy_version


def _require_bookable_patient(db: Session, patient_id: UUID) -> Patient:
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
    return patient


def create_appointment(
    db: Session,
    *,
    patient_id: UUID,
    service_date: date,
    start_time: time,
    care_type: CareType,
    booking_bucket: BookingBucket,
    booking_origin: BookingOrigin = "ADVANCE",
    procedures: list[AppointmentProcedureInput],
    actor_user_id: UUID,
    procedure_set: ProcedureSet | None = None,
    exception_reason: str | None = None,
    additional_slot_id: UUID | None = None,
    same_day_reason: str | None = None,
    same_day_preparation_confirmed: bool = False,
    same_day_clinician_confirmed: bool = False,
    same_day_escort_confirmed: bool = False,
    now: datetime | None = None,
) -> Appointment:
    _reject_past_service_date(service_date, now=now)
    is_afternoon = booking_bucket == "AFTERNOON_EXCEPTION"
    if is_afternoon and not (exception_reason or "").strip():
        raise ApiError(
            status_code=422,
            code="EXCEPTION_REASON_REQUIRED",
            message="14:00 오후 예외 예약에는 사유가 필요합니다.",
        )
    codes = {item.procedure_code for item in procedures}
    if booking_origin == "SAME_DAY":
        local_now = (now or datetime.now(UTC)).astimezone(SEOUL)
        if service_date != local_now.date():
            raise ApiError(
                status_code=422,
                code="SAME_DAY_DATE_REQUIRED",
                message="당일 위내시경은 서울 기준 오늘 날짜에만 등록할 수 있습니다.",
            )
        if codes != {"UPPER"}:
            raise ApiError(
                status_code=422,
                code="SAME_DAY_UPPER_ONLY",
                message="당일 추가 검사는 위내시경만 등록할 수 있습니다.",
            )
        if not (same_day_reason or "").strip():
            raise ApiError(
                status_code=422,
                code="SAME_DAY_REASON_REQUIRED",
                message="당일 위내시경 요청 사유가 필요합니다.",
            )
        if not same_day_preparation_confirmed or not same_day_clinician_confirmed:
            raise ApiError(
                status_code=422,
                code="SAME_DAY_CONFIRMATION_REQUIRED",
                message="검사 준비와 의료진 시행 가능 확인이 필요합니다.",
            )
        is_sedated = any(
            item.procedure_code == "UPPER" and item.sedation_mode == "SEDATED"
            for item in procedures
        )
        if is_sedated and not same_day_escort_confirmed:
            raise ApiError(
                status_code=422,
                code="SAME_DAY_ESCORT_REQUIRED",
                message="수면 위내시경은 귀가 동행 확인이 필요합니다.",
            )
    patient = _require_bookable_patient(db, patient_id)

    resource = get_default_resource(db)
    lock_schedule_date(db, service_date)
    duration, policy = _validate_candidate(
        db,
        service_date=service_date,
        start_time=start_time,
        booking_bucket=booking_bucket,
        procedure_codes=codes,
        procedure_set=procedure_set,
        additional_slot_id=additional_slot_id,
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
        booking_origin=booking_origin,
        care_type=care_type,
        workflow_state=ACTIVE_WORKFLOW_STATE,
        occupies_slot=True,
        schedule_policy_version=policy.policy_version,
        procedure_set=(procedure_set or "SET_60") if codes == {"UPPER", "COLON"} else None,
        additional_slot_id=additional_slot_id,
        same_day_reason=(same_day_reason or "").strip() or None,
        same_day_preparation_confirmed=same_day_preparation_confirmed,
        same_day_clinician_confirmed=same_day_clinician_confirmed,
        same_day_escort_confirmed=same_day_escort_confirmed,
        same_day_confirmed_at=(now or datetime.now(UTC)) if booking_origin == "SAME_DAY" else None,
        exception_reason=exception_reason.strip() if is_afternoon and exception_reason else None,
        exception_registered_by_user_id=actor_user_id if is_afternoon else None,
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
    _record_history(
        db,
        appointment,
        event_type="CREATED",
        before=None,
        reason=(
            "14:00 오후 예외 예약 등록(확인 대기)"
            if is_afternoon
            else "당일 위내시경 등록"
            if booking_origin == "SAME_DAY"
            else "신규 예약 등록"
        ),
        actor_user_id=actor_user_id,
    )
    db.flush()
    return appointment


def exception_status(appointment: Appointment) -> str:
    if appointment.booking_bucket != "AFTERNOON_EXCEPTION":
        return "NOT_APPLICABLE"
    return "CONFIRMED" if appointment.exception_confirmed_at else "PENDING"


def appointment_snapshot(appointment: Appointment) -> dict[str, object]:
    return {
        "patient_id": str(appointment.patient_id),
        "service_date": appointment.service_date.isoformat(),
        "start_time": to_seoul(appointment.scheduled_start_at).strftime("%H:%M"),
        "procedure_set": appointment.procedure_set,
        "end_time": to_seoul(appointment.scheduled_end_at).strftime("%H:%M"),
        "care_type": appointment.care_type,
        "booking_bucket": appointment.booking_bucket,
        "booking_origin": appointment.booking_origin,
        "additional_slot_id": (
            str(appointment.additional_slot_id)
            if appointment.additional_slot_id is not None
            else None
        ),
        "same_day_reason": appointment.same_day_reason,
        "same_day_preparation_confirmed": appointment.same_day_preparation_confirmed,
        "same_day_clinician_confirmed": appointment.same_day_clinician_confirmed,
        "same_day_escort_confirmed": appointment.same_day_escort_confirmed,
        "workflow_state": appointment.workflow_state,
        "exception_status": exception_status(appointment),
        "procedures": [
            {
                "procedure_code": item.procedure_code,
                "sedation_mode": item.sedation_mode,
            }
            for item in sorted(
                appointment.procedures, key=lambda item: item.procedure_code
            )
        ],
    }


def _record_history(
    db: Session,
    appointment: Appointment,
    *,
    event_type: str,
    before: dict[str, object] | None,
    reason: str,
    actor_user_id: UUID,
) -> None:
    after = appointment_snapshot(appointment)
    changed_fields = sorted(
        key for key, value in after.items()
        if before is None or before.get(key) != value
    )
    db.add(
        AppointmentHistoryEvent(
            appointment_id=appointment.id,
            event_type=event_type,
            changed_fields=changed_fields,
            before_values=before,
            after_values=after,
            reason=reason,
            actor_user_id=actor_user_id,
            # 같은 초에 여러 Event가 생겨도 순서가 보존되도록 Application 시각을 쓴다.
            occurred_at=datetime.now(UTC),
        )
    )


def _get_appointment_for_update(db: Session, appointment_id: UUID) -> Appointment:
    appointment = db.scalar(
        select(Appointment)
        .where(Appointment.id == appointment_id)
        .with_for_update()
        .options(
            selectinload(Appointment.procedures),
            selectinload(Appointment.resource),
            selectinload(Appointment.patient),
        )
    )
    if appointment is None:
        raise ApiError(
            status_code=404,
            code="APPOINTMENT_NOT_FOUND",
            message="예약을 찾을 수 없습니다.",
        )
    return appointment


def _ensure_active_version(appointment: Appointment, row_version: int) -> None:
    if appointment.workflow_state != ACTIVE_WORKFLOW_STATE:
        raise ApiError(
            status_code=409,
            code="APPOINTMENT_NOT_ACTIVE",
            message="이미 취소되었거나 No-show로 기록된 예약입니다.",
        )
    if appointment.row_version != row_version:
        raise ApiError(
            status_code=409,
            code="STALE_ROW_VERSION",
            message="다른 사용자가 먼저 예약을 변경했습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.",
        )


def _replace_procedures(
    appointment: Appointment, sedation_by_code: dict[str, str]
) -> None:
    # 같은 검사코드 행은 수정하고, 빠진 검사만 제거해 Unique 제약 충돌을 피한다.
    for procedure in list(appointment.procedures):
        if procedure.procedure_code in sedation_by_code:
            procedure.sedation_mode = sedation_by_code[procedure.procedure_code]
        else:
            appointment.procedures.remove(procedure)
    existing_codes = {item.procedure_code for item in appointment.procedures}
    for code in sorted(set(sedation_by_code) - existing_codes):
        appointment.procedures.append(
            AppointmentProcedure(
                procedure_code=code, sedation_mode=sedation_by_code[code]
            )
        )


def change_appointment(
    db: Session,
    *,
    appointment_id: UUID,
    row_version: int,
    reason: str,
    actor_user_id: UUID,
    service_date: date | None = None,
    start_time: time | None = None,
    care_type: CareType | None = None,
    procedures: list[AppointmentProcedureInput] | None = None,
    procedure_set: ProcedureSet | None = None,
    now: datetime | None = None,
) -> Appointment:
    """같은 Appointment의 Revision으로 일정을 변경한다(DEC-16)."""

    appointment = _get_appointment_for_update(db, appointment_id)
    _ensure_active_version(appointment, row_version)

    old_start = to_seoul(appointment.scheduled_start_at)
    old_end = to_seoul(appointment.scheduled_end_at)
    old_sedation = {
        item.procedure_code: item.sedation_mode for item in appointment.procedures
    }
    new_date = service_date or appointment.service_date
    if new_date != appointment.service_date:
        _reject_past_service_date(new_date, now=now)
    new_start_time = start_time or old_start.time().replace(tzinfo=None)
    new_care_type = care_type or appointment.care_type
    new_sedation = (
        {item.procedure_code: item.sedation_mode for item in procedures}
        if procedures is not None
        else dict(old_sedation)
    )
    new_codes: set[ProcedureCode] = set(new_sedation)  # type: ignore[arg-type]
    if appointment.booking_origin == "SAME_DAY":
        if new_date != today_in_seoul(now):
            raise ApiError(
                status_code=422,
                code="SAME_DAY_DATE_REQUIRED",
                message="당일 위내시경 예약은 다른 날짜로 변경할 수 없습니다.",
            )
        if new_codes != {"UPPER"}:
            raise ApiError(
                status_code=422,
                code="SAME_DAY_UPPER_ONLY",
                message="당일 추가 검사는 위내시경만 유지할 수 있습니다.",
            )
        if (
            new_sedation.get("UPPER") == "SEDATED"
            and not appointment.same_day_escort_confirmed
        ):
            raise ApiError(
                status_code=422,
                code="SAME_DAY_ESCORT_REQUIRED",
                message="수면 위내시경 변경 전 귀가 동행 확인이 필요합니다.",
            )
    if new_codes == {"UPPER", "COLON"}:
        new_procedure_set: ProcedureSet | None = (
            procedure_set
            or (appointment.procedure_set if set(old_sedation) == new_codes else None)  # type: ignore[assignment]
            or "SET_60"
        )
    else:
        procedure_duration(new_codes, procedure_set)
        new_procedure_set = None

    duration = procedure_duration(new_codes, new_procedure_set)
    starts_at = datetime.combine(new_date, new_start_time, tzinfo=SEOUL)
    ends_at = starts_at + timedelta(minutes=duration)
    schedule_changed = (
        new_date != appointment.service_date
        or starts_at != old_start
        or ends_at != old_end
        or set(old_sedation) != new_codes
    )
    if (
        not schedule_changed
        and new_care_type == appointment.care_type
        and new_sedation == old_sedation
        and new_procedure_set == appointment.procedure_set
    ):
        raise ApiError(
            status_code=422,
            code="APPOINTMENT_NO_CHANGES",
            message="변경할 내용이 없습니다.",
        )

    before = appointment_snapshot(appointment)
    for locked_date in sorted({appointment.service_date, new_date}):
        lock_schedule_date(db, locked_date)
    _, policy = _validate_candidate(
        db,
        service_date=new_date,
        start_time=new_start_time,
        booking_bucket=appointment.booking_bucket,  # type: ignore[arg-type]
        procedure_codes=new_codes,
        procedure_set=new_procedure_set,
        additional_slot_id=appointment.additional_slot_id,
        exclude_appointment_id=appointment.id,
    )

    appointment.service_date = new_date
    appointment.scheduled_start_at = starts_at
    appointment.scheduled_end_at = ends_at
    appointment.care_type = new_care_type
    appointment.procedure_set = new_procedure_set
    appointment.schedule_policy_version = policy.policy_version
    _replace_procedures(appointment, new_sedation)
    if appointment.booking_bucket == "AFTERNOON_EXCEPTION" and schedule_changed:
        # 날짜·시간·검사가 바뀐 오후 예외는 변경한 직원이 아닌 다른 직원이 다시 확인한다.
        appointment.exception_registered_by_user_id = actor_user_id
        appointment.exception_confirmed_by_user_id = None
        appointment.exception_confirmed_at = None
    appointment.updated_by_user_id = actor_user_id
    appointment.row_version += 1
    db.flush()
    _record_history(
        db,
        appointment,
        event_type="UPDATED",
        before=before,
        reason=reason,
        actor_user_id=actor_user_id,
    )
    db.flush()
    return appointment


def _release_slot(
    db: Session,
    *,
    appointment_id: UUID,
    row_version: int,
    reason: str,
    actor_user_id: UUID,
    workflow_state: str,
    now: datetime | None = None,
) -> Appointment:
    appointment = _get_appointment_for_update(db, appointment_id)
    _ensure_active_version(appointment, row_version)
    if workflow_state == "NO_SHOW":
        now = now or datetime.now(UTC)
        if to_seoul(appointment.scheduled_start_at) > now:
            raise ApiError(
                status_code=409,
                code="NO_SHOW_TOO_EARLY",
                message="예약 시작시각이 지난 뒤에 No-show로 기록할 수 있습니다.",
            )
    lock_schedule_date(db, appointment.service_date)
    before = appointment_snapshot(appointment)
    appointment.workflow_state = workflow_state
    appointment.occupies_slot = False
    appointment.updated_by_user_id = actor_user_id
    appointment.row_version += 1
    db.flush()
    _record_history(
        db,
        appointment,
        event_type="CANCELLED" if workflow_state == "CANCELLED" else "NO_SHOW",
        before=before,
        reason=reason,
        actor_user_id=actor_user_id,
    )
    db.flush()
    return appointment


def cancel_appointment(
    db: Session,
    *,
    appointment_id: UUID,
    row_version: int,
    reason: str,
    actor_user_id: UUID,
) -> Appointment:
    return _release_slot(
        db,
        appointment_id=appointment_id,
        row_version=row_version,
        reason=reason,
        actor_user_id=actor_user_id,
        workflow_state="CANCELLED",
    )


def record_no_show(
    db: Session,
    *,
    appointment_id: UUID,
    row_version: int,
    reason: str,
    actor_user_id: UUID,
    now: datetime | None = None,
) -> Appointment:
    return _release_slot(
        db,
        appointment_id=appointment_id,
        row_version=row_version,
        reason=reason,
        actor_user_id=actor_user_id,
        workflow_state="NO_SHOW",
        now=now,
    )


def confirm_afternoon_exception(
    db: Session,
    *,
    appointment_id: UUID,
    row_version: int,
    memo: str,
    actor_user_id: UUID,
    now: datetime | None = None,
) -> Appointment:
    appointment = _get_appointment_for_update(db, appointment_id)
    _ensure_active_version(appointment, row_version)
    if appointment.booking_bucket != "AFTERNOON_EXCEPTION":
        raise ApiError(
            status_code=409,
            code="NOT_AN_EXCEPTION_APPOINTMENT",
            message="14:00 오후 예외 예약이 아닙니다.",
        )
    if appointment.exception_confirmed_at is not None:
        raise ApiError(
            status_code=409,
            code="EXCEPTION_ALREADY_CONFIRMED",
            message="이미 확인된 오후 예외 예약입니다.",
        )
    if appointment.exception_registered_by_user_id == actor_user_id:
        raise ApiError(
            status_code=409,
            code="EXCEPTION_CONFIRMER_MUST_DIFFER",
            message="오후 예외는 등록한 직원이 아닌 다른 직원이 확인해야 합니다.",
        )
    policy = resolve_day_policy(db, appointment.service_date)
    if policy.closed or not policy.afternoon_allowed:
        raise ApiError(
            status_code=409,
            code="AFTERNOON_NOT_ALLOWED",
            message="선택한 날짜는 14:00 오후 예외가 허용되지 않았습니다.",
        )

    before = appointment_snapshot(appointment)
    appointment.exception_confirmed_by_user_id = actor_user_id
    appointment.exception_confirmed_at = now or datetime.now(UTC)
    appointment.exception_memo = memo.strip()
    appointment.updated_by_user_id = actor_user_id
    appointment.row_version += 1
    db.flush()
    _record_history(
        db,
        appointment,
        event_type="EXCEPTION_CONFIRMED",
        before=before,
        reason="14:00 오후 예외 확인",
        actor_user_id=actor_user_id,
    )
    db.flush()
    return appointment


def list_appointments(
    db: Session,
    *,
    start_date: date,
    end_date: date,
) -> list[Appointment]:
    if (
        end_date < start_date
        or (end_date - start_date).days > MAX_APPOINTMENT_RANGE_DAYS
    ):
        raise ApiError(
            status_code=422,
            code="DATE_RANGE_INVALID",
            message=(
                "조회 기간은 시작일 이후 최대 "
                f"{MAX_APPOINTMENT_RANGE_DAYS}일까지 지정할 수 있습니다."
            ),
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


def list_appointment_history(
    db: Session, appointment_id: UUID
) -> list[AppointmentHistoryEvent]:
    if db.get(Appointment, appointment_id) is None:
        raise ApiError(
            status_code=404,
            code="APPOINTMENT_NOT_FOUND",
            message="예약을 찾을 수 없습니다.",
        )
    return list(
        db.scalars(
            select(AppointmentHistoryEvent)
            .where(AppointmentHistoryEvent.appointment_id == appointment_id)
            .order_by(AppointmentHistoryEvent.occurred_at)
        ).all()
    )


def find_policy_conflicts(db: Session, service_date: date) -> list[PolicyConflict]:
    """새 날짜 규칙과 어긋나게 된 활성 예약을 찾는다. 자동 취소·이동하지 않는다."""

    policy = resolve_day_policy(db, service_date)
    appointments = list(
        db.scalars(
            select(Appointment)
            .where(
                Appointment.service_date == service_date,
                Appointment.occupies_slot.is_(True),
            )
            .options(selectinload(Appointment.procedures))
            .order_by(Appointment.scheduled_start_at)
        ).all()
    )
    conflicts: list[PolicyConflict] = []
    upper_count = 0
    colon_count = 0
    for appointment in appointments:
        if policy.closed or policy.morning is None:
            conflicts.append(PolicyConflict(appointment, "CLOSED"))
            continue
        if appointment.booking_bucket == "AFTERNOON_EXCEPTION":
            if not policy.afternoon_allowed:
                conflicts.append(PolicyConflict(appointment, "AFTERNOON_NOT_ALLOWED"))
            continue
        rule = policy.morning
        start_minute = time_to_minutes(to_seoul(appointment.scheduled_start_at).time())
        end_minute = time_to_minutes(to_seoul(appointment.scheduled_end_at).time())
        if start_minute < rule.start_minute or end_minute > rule.end_minute:
            conflicts.append(PolicyConflict(appointment, "OUTSIDE_OPERATING_HOURS"))
            continue
        codes = _procedure_codes(appointment)
        upper_count += int("UPPER" in codes)
        colon_count += int("COLON" in codes)
        if (
            rule.upper_capacity is not None and upper_count > rule.upper_capacity
        ) or (
            rule.colon_capacity is not None and colon_count > rule.colon_capacity
        ):
            conflicts.append(PolicyConflict(appointment, "CAPACITY_EXCEEDED"))
    return conflicts
