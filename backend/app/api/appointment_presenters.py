from __future__ import annotations

from app.core.clock import to_seoul
from app.models import Appointment, AppointmentHistoryEvent
from app.schemas.appointment import (
    AppointmentHistoryEventResponse,
    AppointmentProcedureResponse,
    AppointmentResponse,
)
from app.schemas.patient import AgeMethod
from app.services.appointments import exception_status
from app.services.patients import calculate_age


def present_appointment(appointment: Appointment) -> AppointmentResponse:
    age_method: AgeMethod = (
        "SCREENING_YEAR_AGE"
        if appointment.care_type == "SCREENING"
        else "FULL_AGE"
    )
    duration = int(
        (
            appointment.scheduled_end_at
            - appointment.scheduled_start_at
        ).total_seconds()
        // 60
    )
    return AppointmentResponse(
        id=appointment.id,
        patient_id=appointment.patient_id,
        patient_name=appointment.patient.name,
        chart_number=appointment.patient.chart_number,
        birth_date=appointment.patient.birth_date,
        sex=appointment.patient.sex,
        age=calculate_age(
            appointment.patient.birth_date,
            appointment.service_date,
            age_method,
        ),
        age_method=age_method,
        resource_code=appointment.resource.code,
        service_date=appointment.service_date,
        start_time=to_seoul(appointment.scheduled_start_at).time(),
        end_time=to_seoul(appointment.scheduled_end_at).time(),
        duration_minutes=duration,
        procedure_set=appointment.procedure_set,
        care_type=appointment.care_type,
        booking_bucket=appointment.booking_bucket,
        booking_origin=appointment.booking_origin,
        additional_slot_id=appointment.additional_slot_id,
        same_day_reason=appointment.same_day_reason,
        same_day_preparation_confirmed=appointment.same_day_preparation_confirmed,
        same_day_clinician_confirmed=appointment.same_day_clinician_confirmed,
        same_day_escort_confirmed=appointment.same_day_escort_confirmed,
        same_day_confirmed_at=appointment.same_day_confirmed_at,
        workflow_state=appointment.workflow_state,
        exception_status=exception_status(appointment),
        exception_reason=appointment.exception_reason,
        exception_memo=appointment.exception_memo,
        exception_registered_by_user_id=appointment.exception_registered_by_user_id,
        exception_confirmed_by_user_id=appointment.exception_confirmed_by_user_id,
        exception_confirmed_at=appointment.exception_confirmed_at,
        schedule_policy_version=appointment.schedule_policy_version,
        procedures=[
            AppointmentProcedureResponse(
                procedure_code=item.procedure_code,
                sedation_mode=item.sedation_mode,
            )
            for item in appointment.procedures
        ],
        row_version=appointment.row_version,
        created_at=appointment.created_at,
        updated_at=appointment.updated_at,
    )


def present_appointment_history(
    event: AppointmentHistoryEvent,
) -> AppointmentHistoryEventResponse:
    return AppointmentHistoryEventResponse(
        id=event.id,
        event_type=event.event_type,
        changed_fields=list(event.changed_fields),
        before_values=event.before_values,
        after_values=event.after_values,
        reason=event.reason,
        actor_user_id=event.actor_user_id,
        occurred_at=event.occurred_at,
    )
