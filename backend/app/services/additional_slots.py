from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import ApiError
from app.models import Appointment, ScheduleAdditionalSlot
from app.services.appointments import (
    AFTERNOON_START,
    SEOUL,
    SLOT_MINUTES,
    available_slots,
    get_default_resource,
    lock_schedule_date,
    resolve_day_policy,
    to_seoul,
)


def _minutes(value: time) -> int:
    return value.hour * 60 + value.minute


def _on_grid(value: time) -> bool:
    return (
        value.second == 0
        and value.microsecond == 0
        and value.minute % SLOT_MINUTES == 0
    )


def _overlaps(start: int, end: int, other_start: int, other_end: int) -> bool:
    return start < other_end and other_start < end


def list_additional_slots(
    db: Session, *, service_date: date
) -> list[ScheduleAdditionalSlot]:
    return list(
        db.scalars(
            select(ScheduleAdditionalSlot)
            .where(ScheduleAdditionalSlot.service_date == service_date)
            .order_by(ScheduleAdditionalSlot.start_time)
        ).all()
    )


def create_additional_slot(
    db: Session,
    *,
    service_date: date,
    start_time: time,
    reason: str,
    actor_user_id: UUID,
    now: datetime | None = None,
) -> ScheduleAdditionalSlot:
    local_now = (now or datetime.now(UTC)).astimezone(SEOUL)
    if service_date != local_now.date():
        raise ApiError(
            status_code=422,
            code="SAME_DAY_DATE_REQUIRED",
            message="당일 연장 슬롯은 서울 기준 오늘 날짜에만 개설할 수 있습니다.",
        )
    if not _on_grid(start_time):
        raise ApiError(
            status_code=422,
            code="TIME_GRID_INVALID",
            message="당일 연장 슬롯은 30분 단위로 개설해야 합니다.",
        )
    policy = resolve_day_policy(db, service_date)
    if policy.closed or policy.morning is None:
        raise ApiError(
            status_code=409,
            code="SCHEDULE_CLOSED",
            message="휴진일에는 당일 연장 슬롯을 개설할 수 없습니다.",
        )
    start_minute = _minutes(start_time)
    end_minute = start_minute + SLOT_MINUTES
    if start_minute < policy.morning.end_minute or end_minute > _minutes(AFTERNOON_START):
        raise ApiError(
            status_code=422,
            code="ADDITIONAL_SLOT_OUTSIDE_EXTENSION_WINDOW",
            message="연장 슬롯은 오전 운영 종료 후부터 14:00 전까지 개설할 수 있습니다.",
        )
    if datetime.combine(service_date, start_time, tzinfo=SEOUL) <= local_now:
        raise ApiError(
            status_code=422,
            code="ADDITIONAL_SLOT_IN_PAST",
            message="이미 지난 시각에는 당일 연장 슬롯을 개설할 수 없습니다.",
        )

    _, standard_slots, _ = available_slots(
        db,
        service_date=service_date,
        procedure_codes={"UPPER"},
        booking_bucket="STANDARD_MORNING",
        booking_origin="SAME_DAY",
        now=now,
    )
    if standard_slots:
        raise ApiError(
            status_code=409,
            code="STANDARD_SLOT_AVAILABLE",
            message="사용 가능한 일반 30분 슬롯이 있어 연장 슬롯을 열 수 없습니다.",
        )

    resource = get_default_resource(db)
    lock_schedule_date(db, service_date)
    appointments = list(
        db.scalars(
            select(Appointment).where(
                Appointment.resource_id == resource.id,
                Appointment.service_date == service_date,
                Appointment.occupies_slot.is_(True),
            )
        ).all()
    )
    if any(
        _overlaps(
            start_minute,
            end_minute,
            _minutes(to_seoul(item.scheduled_start_at).time()),
            _minutes(to_seoul(item.scheduled_end_at).time()),
        )
        for item in appointments
    ):
        raise ApiError(
            status_code=409,
            code="TIME_CONFLICT",
            message="선택한 연장 시간이 기존 예약과 겹칩니다.",
        )
    existing_slots = list(
        db.scalars(
            select(ScheduleAdditionalSlot).where(
                ScheduleAdditionalSlot.resource_id == resource.id,
                ScheduleAdditionalSlot.service_date == service_date,
                ScheduleAdditionalSlot.status == "APPROVED",
            )
        ).all()
    )
    if any(
        _overlaps(
            start_minute,
            end_minute,
            _minutes(item.start_time),
            _minutes(item.end_time),
        )
        for item in existing_slots
    ):
        raise ApiError(
            status_code=409,
            code="ADDITIONAL_SLOT_CONFLICT",
            message="같은 시간에 이미 승인된 연장 슬롯이 있습니다.",
        )

    end_time = (datetime.combine(service_date, start_time) + timedelta(minutes=30)).time()
    slot = ScheduleAdditionalSlot(
        resource_id=resource.id,
        service_date=service_date,
        start_time=start_time,
        end_time=end_time,
        reason=reason.strip(),
        status="APPROVED",
        approved_by_user_id=actor_user_id,
        approved_at=now or datetime.now(UTC),
    )
    db.add(slot)
    db.flush()
    return slot


def revoke_additional_slot(
    db: Session,
    *,
    slot_id: UUID,
    reason: str,
    actor_user_id: UUID,
    now: datetime | None = None,
) -> ScheduleAdditionalSlot:
    slot = db.scalar(
        select(ScheduleAdditionalSlot)
        .where(ScheduleAdditionalSlot.id == slot_id)
        .with_for_update()
    )
    if slot is None:
        raise ApiError(
            status_code=404,
            code="ADDITIONAL_SLOT_NOT_FOUND",
            message="연장 슬롯을 찾을 수 없습니다.",
        )
    if slot.status != "APPROVED":
        raise ApiError(
            status_code=409,
            code="ADDITIONAL_SLOT_NOT_ACTIVE",
            message="이미 취소된 연장 슬롯입니다.",
        )
    occupied = db.scalar(
        select(Appointment.id).where(
            Appointment.additional_slot_id == slot.id,
            Appointment.occupies_slot.is_(True),
        )
    )
    if occupied is not None:
        raise ApiError(
            status_code=409,
            code="ADDITIONAL_SLOT_OCCUPIED",
            message="예약이 연결된 연장 슬롯은 예약을 먼저 취소해야 합니다.",
        )
    lock_schedule_date(db, slot.service_date)
    slot.status = "REVOKED"
    slot.revoked_by_user_id = actor_user_id
    slot.revoked_at = now or datetime.now(UTC)
    slot.revoke_reason = reason.strip()
    db.flush()
    return slot
    available_slots,
