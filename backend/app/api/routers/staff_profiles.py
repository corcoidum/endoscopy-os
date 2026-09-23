from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.api.dependencies import Principal, require_permission, verify_csrf
from app.db.session import get_db
from app.models import StaffProfile
from app.schemas.common import ErrorResponse
from app.schemas.staff_profile import (
    StaffProfileActivationRequest,
    StaffProfileCreateRequest,
    StaffProfileListResponse,
    StaffProfileResponse,
    StaffType,
)
from app.services import staff_profiles as staff_profile_service

router = APIRouter(prefix="/staff-profiles", tags=["staff-profiles"])
identity_manager = require_permission("identity.manage")
medication_reader = require_permission("medication.read")

MUTATION_RESPONSES: dict[int | str, dict[str, object]] = {
    403: {"model": ErrorResponse},
    404: {"model": ErrorResponse},
    409: {"model": ErrorResponse},
    422: {"model": ErrorResponse},
}


def _present(profile: StaffProfile) -> StaffProfileResponse:
    return StaffProfileResponse(
        id=profile.id,
        display_name=profile.display_name,
        staff_type=profile.staff_type,
        employee_code=profile.employee_code,
        is_active=profile.is_active,
        deactivated_at=profile.deactivated_at,
    )


@router.get("", response_model=StaffProfileListResponse)
def list_staff_profiles(
    staff_type: StaffType | None = Query(default=None),
    include_inactive: bool = Query(default=False),
    _: Principal = Depends(identity_manager),
    db: Session = Depends(get_db),
) -> StaffProfileListResponse:
    return StaffProfileListResponse(
        items=[
            _present(profile)
            for profile in staff_profile_service.list_staff_profiles(
                db, staff_type=staff_type, include_inactive=include_inactive
            )
        ]
    )


@router.get("/physicians", response_model=StaffProfileListResponse)
def list_active_physicians(
    _: Principal = Depends(medication_reader),
    db: Session = Depends(get_db),
) -> StaffProfileListResponse:
    """의사 결정을 기록할 때 쓸 활성 의사 Profile. 예약 등록 화면이 함께 쓴다."""

    return StaffProfileListResponse(
        items=[_present(profile) for profile in staff_profile_service.active_physicians(db)]
    )


@router.post(
    "",
    response_model=StaffProfileResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_csrf)],
    responses=MUTATION_RESPONSES,
)
def create_staff_profile(
    payload: StaffProfileCreateRequest,
    _: Principal = Depends(identity_manager),
    db: Session = Depends(get_db),
) -> StaffProfileResponse:
    profile = staff_profile_service.create_staff_profile(
        db,
        display_name=payload.display_name,
        staff_type=payload.staff_type,
        employee_code=payload.employee_code,
    )
    db.commit()
    return _present(profile)


@router.patch(
    "/{profile_id}/activation",
    response_model=StaffProfileResponse,
    dependencies=[Depends(verify_csrf)],
    responses=MUTATION_RESPONSES,
)
def set_staff_profile_activation(
    profile_id: UUID,
    payload: StaffProfileActivationRequest,
    _: Principal = Depends(identity_manager),
    db: Session = Depends(get_db),
) -> StaffProfileResponse:
    profile = staff_profile_service.set_staff_profile_activation(
        db, profile_id, is_active=payload.is_active
    )
    db.commit()
    return _present(profile)
