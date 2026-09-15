from __future__ import annotations

from app.models import Appointment
from app.schemas.appointment import (
    AppointmentProcedureResponse,
    AppointmentResponse,
)
from app.services.appointments import to_seoul
from app.services.patients import calculate_age


def present_appointment(appointment: Appointment) -> AppointmentResponse:
    age_method = (
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
        sex=appointment.patient.sex,  # type: ignore[arg-type]
        age=calculate_age(
            appointment.patient.birth_date,
            appointment.service_date,
            age_method,  # type: ignore[arg-type]
        ),
        age_method=age_method,
        resource_code=appointment.resource.code,
        service_date=appointment.service_date,
        start_time=to_seoul(appointment.scheduled_start_at).time(),
        end_time=to_seoul(appointment.scheduled_end_at).time(),
        duration_minutes=duration,
        procedure_set=appointment.procedure_set,  # type: ignore[arg-type]
        care_type=appointment.care_type,  # type: ignore[arg-type]
        booking_bucket=appointment.booking_bucket,  # type: ignore[arg-type]
        workflow_state=appointment.workflow_state,  # type: ignore[arg-type]
        schedule_policy_version=appointment.schedule_policy_version,
        procedures=[
            AppointmentProcedureResponse(
                procedure_code=item.procedure_code,  # type: ignore[arg-type]
                sedation_mode=item.sedation_mode,  # type: ignore[arg-type]
            )
            for item in appointment.procedures
        ],
        row_version=appointment.row_version,
        created_at=appointment.created_at,
        updated_at=appointment.updated_at,
    )
