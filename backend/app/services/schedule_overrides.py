from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import ApiError
from app.models import ScheduleDateOverride
from app.services.appointments import (
    AFTERNOON_START,
    SLOT_MINUTES,
    PolicyConflict,
    ResolvedDayPolicy,
    find_policy_conflicts,
    get_default_resource,
    lock_schedule_date,
    resolve_day_policy,
)


MAX_OVERRIDE_LIST_DAYS = 366
MAX_DAY_POLICY_DAYS = 62


def _invalid_override(message: str) -> ApiError:
    return ApiError(
        status_code=422, code="INVALID_OVERRIDE_VALUE", message=message
    )


def _on_slot_grid(value: time) -> bool:
    return (
        value.second == 0
        and value.microsecond == 0
        and value.minute % SLOT_MINUTES == 0
    )


def _validate_date_range(start_date: date, end_date: date, max_days: int) -> None:
    if end_date < start_date or (end_date - start_date).days > max_days:
        raise ApiError(
            status_code=422,
            code="DATE_RANGE_INVALID",
            message=f"조회 기간은 시작일 이후 최대 {max_days}일까지 지정할 수 있습니다.",
        )


def validate_override_values(
    *,
    service_date: date,
    rule_type: str,
    override_start_time: time | None,
    override_end_time: time | None,
    override_upper_capacity: int | None,
    override_colon_capacity: int | None,
) -> None:
    has_times = override_start_time is not None or override_end_time is not None
    has_capacity = (
        override_upper_capacity is not None
        or override_colon_capacity is not None
    )
    if service_date.isoweekday() == 7 and rule_type != "CLOSED":
        raise _invalid_override(
            "일요일은 기본 휴진일이라 운영시간·수용량·오후 예외를 지정할 수 없습니다."
        )
    if rule_type == "OPERATING_HOURS":
        if override_start_time is None or override_end_time is None or has_capacity:
            raise _invalid_override("운영시간 변경에는 시작·종료 시각만 입력해 주세요.")
        # 추가·변경 Slot은 30분 경계만 허용한다(DEC-20).
        if not (
            _on_slot_grid(override_start_time) and _on_slot_grid(override_end_time)
        ):
            raise _invalid_override("운영시간은 30분 단위로 입력해 주세요.")
        if override_start_time >= override_end_time:
            raise _invalid_override("운영 종료시각은 시작시각보다 늦어야 합니다.")
        if override_end_time > AFTERNOON_START:
            raise _invalid_override("오전 운영시간은 14:00 이전에 끝나야 합니다.")
    elif rule_type == "CAPACITY":
        if not has_capacity or has_times:
            raise _invalid_override("수용량 변경에는 위 또는 대장 수용량만 입력해 주세요.")
    elif has_times or has_capacity:
        raise _invalid_override("휴진·오후 예외 허용에는 시각이나 수용량을 입력하지 않습니다.")


def list_overrides(
    db: Session, *, start_date: date, end_date: date
) -> list[ScheduleDateOverride]:
    _validate_date_range(start_date, end_date, MAX_OVERRIDE_LIST_DAYS)
    return list(
        db.scalars(
            select(ScheduleDateOverride)
            .where(
                ScheduleDateOverride.service_date >= start_date,
                ScheduleDateOverride.service_date <= end_date,
            )
            .order_by(
                ScheduleDateOverride.service_date,
                ScheduleDateOverride.created_at,
            )
        ).all()
    )


def create_override(
    db: Session,
    *,
    service_date: date,
    rule_type: str,
    override_start_time: time | None,
    override_end_time: time | None,
    override_upper_capacity: int | None,
    override_colon_capacity: int | None,
    reason: str,
    actor_user_id: UUID,
) -> ScheduleDateOverride:
    validate_override_values(
        service_date=service_date,
        rule_type=rule_type,
        override_start_time=override_start_time,
        override_end_time=override_end_time,
        override_upper_capacity=override_upper_capacity,
        override_colon_capacity=override_colon_capacity,
    )
    resource = get_default_resource(db)
    override = ScheduleDateOverride(
        resource_id=resource.id,
        service_date=service_date,
        rule_type=rule_type,
        override_start_time=override_start_time,
        override_end_time=override_end_time,
        override_upper_capacity=override_upper_capacity,
        override_colon_capacity=override_colon_capacity,
        reason=reason.strip(),
        status="PENDING",
        requested_by_user_id=actor_user_id,
    )
    db.add(override)
    db.flush()
    return override


def _get_override_for_update(db: Session, override_id: UUID) -> ScheduleDateOverride:
    override = db.scalar(
        select(ScheduleDateOverride)
        .where(ScheduleDateOverride.id == override_id)
        .with_for_update()
    )
    if override is None:
        raise ApiError(
            status_code=404,
            code="SCHEDULE_OVERRIDE_NOT_FOUND",
            message="일정 예외를 찾을 수 없습니다.",
        )
    return override


def approve_override(
    db: Session,
    *,
    override_id: UUID,
    actor_user_id: UUID,
    now: datetime | None = None,
) -> tuple[ScheduleDateOverride, list[PolicyConflict]]:
    override = _get_override_for_update(db, override_id)
    if override.status != "PENDING":
        raise ApiError(
            status_code=409,
            code="OVERRIDE_NOT_PENDING",
            message="승인 대기 중인 일정 예외만 승인할 수 있습니다.",
        )
    lock_schedule_date(db, override.service_date)
    # 같은 날짜·종류의 기존 승인 Rule은 덮어쓰지 않고 새 Rule로 대체 처리한다.
    previous = db.scalar(
        select(ScheduleDateOverride)
        .where(
            ScheduleDateOverride.resource_id == override.resource_id,
            ScheduleDateOverride.service_date == override.service_date,
            ScheduleDateOverride.rule_type == override.rule_type,
            ScheduleDateOverride.status == "APPROVED",
        )
        .with_for_update()
    )
    if previous is not None:
        previous.status = "SUPERSEDED"
        previous.superseded_by_id = override.id
        db.flush()
    override.status = "APPROVED"
    override.approved_by_user_id = actor_user_id
    override.approved_at = now or datetime.now(UTC)
    db.flush()
    return override, find_policy_conflicts(db, override.service_date)


def revoke_override(
    db: Session,
    *,
    override_id: UUID,
    reason: str,
    actor_user_id: UUID,
    now: datetime | None = None,
) -> tuple[ScheduleDateOverride, list[PolicyConflict]]:
    override = _get_override_for_update(db, override_id)
    if override.status not in {"PENDING", "APPROVED"}:
        raise ApiError(
            status_code=409,
            code="OVERRIDE_NOT_ACTIVE",
            message="이미 취소되었거나 대체된 일정 예외입니다.",
        )
    lock_schedule_date(db, override.service_date)
    override.status = "REVOKED"
    override.revoked_by_user_id = actor_user_id
    override.revoked_at = now or datetime.now(UTC)
    override.revoke_reason = reason.strip()
    db.flush()
    return override, find_policy_conflicts(db, override.service_date)


def resolve_day_policies(
    db: Session, *, start_date: date, end_date: date
) -> list[ResolvedDayPolicy]:
    _validate_date_range(start_date, end_date, MAX_DAY_POLICY_DAYS)
    return [
        resolve_day_policy(db, start_date + timedelta(days=offset))
        for offset in range((end_date - start_date).days + 1)
    ]
