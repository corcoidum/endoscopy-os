from __future__ import annotations

from datetime import date

from app.models import Patient
from app.schemas.patient import (
    AgeMethod,
    PatientDetailResponse,
    PatientHistoryEventResponse,
    PatientSummaryResponse,
)
from app.services.patients import (
    PatientHistoryRecord,
    PatientRecord,
    calculate_age,
)


def present_patient_summary(
    patient: Patient,
    *,
    reference_date: date,
    age_method: AgeMethod,
) -> PatientSummaryResponse:
    cancellation_count = patient.cancellation_count_cache
    no_show_count = patient.no_show_count_cache
    return PatientSummaryResponse(
        id=patient.id,
        chart_number=patient.chart_number,
        name=patient.name,
        birth_date=patient.birth_date,
        sex=patient.sex,  # type: ignore[arg-type]
        age=calculate_age(patient.birth_date, reference_date, age_method),
        age_method=age_method,
        age_reference_date=reference_date,
        cancellation_count=cancellation_count,
        no_show_count=no_show_count,
        requires_booking_review=(cancellation_count + no_show_count >= 3),
        is_active=patient.is_active,
        row_version=patient.row_version,
    )


def present_patient_detail(
    record: PatientRecord,
    *,
    reference_date: date,
    age_method: AgeMethod,
) -> PatientDetailResponse:
    summary = present_patient_summary(
        record.patient,
        reference_date=reference_date,
        age_method=age_method,
    )
    return PatientDetailResponse(
        **summary.model_dump(),
        phone=record.phone,
        special_notes=record.special_notes,
        created_at=record.patient.created_at,
        updated_at=record.patient.updated_at,
    )


def present_patient_history(
    record: PatientHistoryRecord,
) -> PatientHistoryEventResponse:
    event = record.event
    return PatientHistoryEventResponse(
        id=event.id,
        event_type=event.event_type,  # type: ignore[arg-type]
        changed_fields=event.changed_fields,
        before_values=event.before_values,
        after_values=event.after_values,
        reason=event.reason,
        actor_user_id=event.actor_user_id,
        actor_display_name=record.actor_display_name,
        occurred_at=event.occurred_at,
    )
