from __future__ import annotations

from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.dependencies import Principal, require_permission, verify_csrf
from app.api.patient_presenters import (
    present_patient_detail,
    present_patient_history,
    present_patient_summary,
)
from app.core.config import Settings, get_settings
from app.core.exceptions import ApiError
from app.db.session import get_db
from app.schemas.common import ErrorResponse
from app.schemas.patient import (
    AgeMethod,
    ChartNumberAvailabilityResponse,
    PatientActivationRequest,
    PatientAgeResponse,
    PatientCreateRequest,
    PatientDetailResponse,
    PatientHistoryEventResponse,
    PatientListResponse,
    PatientMutationResponse,
    PatientUpdateRequest,
    PatientWarningResponse,
    SexCode,
)
from app.services import patients as patient_service


router = APIRouter(prefix="/patients", tags=["patients"])
patient_reader = require_permission("patient.read")
patient_creator = require_permission("patient.create")
patient_updater = require_permission("patient.update")


def _reference_date(value: date | None) -> date:
    return value or date.today()


def _duplicate_warning(
    duplicates,
    *,
    reference_date: date,
    age_method: AgeMethod,
) -> list[PatientWarningResponse]:
    if not duplicates:
        return []
    return [
        PatientWarningResponse(
            code="DEMOGRAPHIC_DUPLICATE_CANDIDATE",
            message="이름·생년월일·성별이 같은 환자가 있습니다. 차트번호를 다시 확인해 주세요.",
            candidates=[
                present_patient_summary(
                    patient,
                    reference_date=reference_date,
                    age_method=age_method,
                )
                for patient in duplicates
            ],
        )
    ]


@router.get("", response_model=PatientListResponse)
def get_patients(
    query: str | None = Query(default=None, max_length=100),
    birth_date: date | None = None,
    sex: SexCode | None = None,
    include_inactive: bool = False,
    reference_date: date | None = None,
    age_method: AgeMethod = "FULL_AGE",
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    _: Principal = Depends(patient_reader),
    db: Session = Depends(get_db),
) -> PatientListResponse:
    effective_date = _reference_date(reference_date)
    result = patient_service.search_patients(
        db,
        query=query,
        birth_date=birth_date,
        sex=sex,
        include_inactive=include_inactive,
        limit=limit,
        offset=offset,
    )
    return PatientListResponse(
        items=[
            present_patient_summary(
                patient,
                reference_date=effective_date,
                age_method=age_method,
            )
            for patient in result.patients
        ],
        total=result.total,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/chart-number-availability",
    response_model=ChartNumberAvailabilityResponse,
)
def get_chart_number_availability(
    chart_number: str = Query(min_length=1, max_length=40),
    _: Principal = Depends(patient_reader),
    db: Session = Depends(get_db),
) -> ChartNumberAvailabilityResponse:
    display, normalized, patient = patient_service.chart_number_availability(
        db, chart_number
    )
    return ChartNumberAvailabilityResponse(
        chart_number=display,
        normalized_chart_number=normalized,
        available=patient is None,
        existing_patient_id=patient.id if patient is not None else None,
        existing_patient_active=(
            patient.is_active if patient is not None else None
        ),
    )


@router.post(
    "",
    response_model=PatientMutationResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_csrf)],
    responses={
        403: {"model": ErrorResponse},
        409: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
    },
)
def create_patient(
    payload: PatientCreateRequest,
    principal: Principal = Depends(patient_creator),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> PatientMutationResponse:
    try:
        record, duplicates = patient_service.create_patient(
            db,
            chart_number=payload.chart_number,
            name=payload.name,
            birth_date=payload.birth_date,
            sex=payload.sex,
            phone=payload.phone,
            special_notes=payload.special_notes,
            actor_user_id=principal.user.id,
            settings=settings,
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ApiError(
            status_code=409,
            code="CHART_NUMBER_DUPLICATE",
            message="이미 등록된 차트번호입니다. 기존 환자를 확인해 주세요.",
        ) from exc
    effective_date = date.today()
    return PatientMutationResponse(
        patient=present_patient_detail(
            record,
            reference_date=effective_date,
            age_method="FULL_AGE",
        ),
        warnings=_duplicate_warning(
            duplicates,
            reference_date=effective_date,
            age_method="FULL_AGE",
        ),
    )


@router.get("/{patient_id}/age", response_model=PatientAgeResponse)
def get_patient_age(
    patient_id: UUID,
    reference_date: date,
    method: AgeMethod,
    _: Principal = Depends(patient_reader),
    db: Session = Depends(get_db),
) -> PatientAgeResponse:
    patient = patient_service.get_patient(db, patient_id)
    return PatientAgeResponse(
        patient_id=patient.id,
        birth_date=patient.birth_date,
        reference_date=reference_date,
        method=method,
        age=patient_service.calculate_age(
            patient.birth_date, reference_date, method
        ),
    )


@router.get(
    "/{patient_id}/history",
    response_model=list[PatientHistoryEventResponse],
)
def get_patient_history(
    patient_id: UUID,
    _: Principal = Depends(patient_reader),
    db: Session = Depends(get_db),
) -> list[PatientHistoryEventResponse]:
    return [
        present_patient_history(record)
        for record in patient_service.list_patient_history(db, patient_id)
    ]


@router.get("/{patient_id}", response_model=PatientDetailResponse)
def get_patient(
    patient_id: UUID,
    reference_date: date | None = None,
    age_method: AgeMethod = "FULL_AGE",
    _: Principal = Depends(patient_reader),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> PatientDetailResponse:
    return present_patient_detail(
        patient_service.get_patient_record(
            db, patient_id, settings=settings
        ),
        reference_date=_reference_date(reference_date),
        age_method=age_method,
    )


@router.patch(
    "/{patient_id}",
    response_model=PatientMutationResponse,
    dependencies=[Depends(verify_csrf)],
    responses={
        403: {"model": ErrorResponse},
        409: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
    },
)
def update_patient(
    patient_id: UUID,
    payload: PatientUpdateRequest,
    principal: Principal = Depends(patient_updater),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> PatientMutationResponse:
    updates = payload.model_dump(
        exclude={"row_version", "reason"},
        exclude_unset=True,
    )
    try:
        record, duplicates = patient_service.update_patient(
            db,
            patient_id=patient_id,
            row_version=payload.row_version,
            reason=payload.reason,
            updates=updates,
            actor_user_id=principal.user.id,
            settings=settings,
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ApiError(
            status_code=409,
            code="CHART_NUMBER_DUPLICATE",
            message="이미 등록된 차트번호입니다. 기존 환자를 확인해 주세요.",
        ) from exc
    effective_date = date.today()
    return PatientMutationResponse(
        patient=present_patient_detail(
            record,
            reference_date=effective_date,
            age_method="FULL_AGE",
        ),
        warnings=_duplicate_warning(
            duplicates,
            reference_date=effective_date,
            age_method="FULL_AGE",
        ),
    )


@router.patch(
    "/{patient_id}/activation",
    response_model=PatientMutationResponse,
    dependencies=[Depends(verify_csrf)],
)
def update_patient_activation(
    patient_id: UUID,
    payload: PatientActivationRequest,
    principal: Principal = Depends(patient_updater),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> PatientMutationResponse:
    record = patient_service.set_patient_activation(
        db,
        patient_id=patient_id,
        row_version=payload.row_version,
        is_active=payload.is_active,
        reason=payload.reason,
        actor_user_id=principal.user.id,
        settings=settings,
    )
    db.commit()
    return PatientMutationResponse(
        patient=present_patient_detail(
            record,
            reference_date=date.today(),
            age_method="FULL_AGE",
        )
    )
