"""직원·의료진 명부(StaffProfile) 관리.

로그인 계정과 분리된 명부다. 의사 결정 기록에는 로그인한 사용자와 별도로 결정한
의사의 Profile을 남긴다(DEC-07). 명부는 지우지 않고 비활성화한다.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.exceptions import ApiError
from app.models import StaffProfile

PHYSICIAN_STAFF_TYPE = "DOCTOR"


def list_staff_profiles(
    db: Session, *, staff_type: str | None = None, include_inactive: bool = False
) -> list[StaffProfile]:
    statement = select(StaffProfile).order_by(
        StaffProfile.is_active.desc(), StaffProfile.display_name
    )
    if staff_type is not None:
        statement = statement.where(StaffProfile.staff_type == staff_type)
    if not include_inactive:
        statement = statement.where(StaffProfile.is_active.is_(True))
    return list(db.scalars(statement).all())


def active_physicians(db: Session) -> list[StaffProfile]:
    return list_staff_profiles(db, staff_type=PHYSICIAN_STAFF_TYPE)


def create_staff_profile(
    db: Session,
    *,
    display_name: str,
    staff_type: str,
    employee_code: str | None,
) -> StaffProfile:
    profile = StaffProfile(
        display_name=display_name.strip(),
        staff_type=staff_type,
        employee_code=(employee_code or "").strip() or None,
        is_active=True,
    )
    db.add(profile)
    try:
        db.flush()
    except IntegrityError as exc:
        raise ApiError(
            status_code=409,
            code="EMPLOYEE_CODE_DUPLICATE",
            message="이미 등록된 직원번호입니다.",
        ) from exc
    return profile


def set_staff_profile_activation(
    db: Session,
    profile_id: UUID,
    *,
    is_active: bool,
    now: datetime | None = None,
) -> StaffProfile:
    profile = db.scalar(
        select(StaffProfile).where(StaffProfile.id == profile_id).with_for_update()
    )
    if profile is None:
        raise ApiError(
            status_code=404,
            code="STAFF_PROFILE_NOT_FOUND",
            message="직원 명부를 찾을 수 없습니다.",
        )
    if profile.is_active != is_active:
        profile.is_active = is_active
        profile.deactivated_at = None if is_active else (now or datetime.now(UTC))
        db.flush()
    return profile
