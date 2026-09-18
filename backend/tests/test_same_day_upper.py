from datetime import UTC, date, datetime, time

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.core.exceptions import ApiError
from app.models import AppointmentHistoryEvent, Patient, User
from app.schemas.appointment import AppointmentProcedureInput
from app.services import additional_slots
from app.services.appointments import create_appointment
from tests.conftest import SeededIdentity


UPPER = [
    AppointmentProcedureInput(
        procedure_code="UPPER",
        sedation_mode="NON_SEDATED",
    )
]
COLON = [
    AppointmentProcedureInput(
        procedure_code="COLON",
        sedation_mode="NON_SEDATED",
    )
]
FIXED_NOW = datetime(2026, 9, 17, 0, 0, tzinfo=UTC)  # 서울 09:00
SERVICE_DATE = date(2026, 9, 17)


def _patient_and_actor(db: Session) -> tuple[Patient, User]:
    actor = db.scalar(select(User))
    assert actor is not None
    patient = Patient(
        chart_number="SYN-SAME-DAY-001",
        chart_number_normalized="syn-same-day-001",
        name="합성당일환자",
        birth_date=date(1980, 1, 1),
        sex="FEMALE",
        is_active=True,
        created_by_user_id=actor.id,
        updated_by_user_id=actor.id,
    )
    db.add(patient)
    db.flush()
    return patient, actor


def test_same_day_rejects_colon_with_stable_error_code(
    session_factory: sessionmaker[Session],
    seeded_identity: SeededIdentity,
) -> None:
    with session_factory() as db:
        patient, actor = _patient_and_actor(db)
        with pytest.raises(ApiError) as captured:
            create_appointment(
                db,
                patient_id=patient.id,
                service_date=SERVICE_DATE,
                start_time=time(9, 30),
                care_type="GENERAL",
                booking_bucket="STANDARD_MORNING",
                booking_origin="SAME_DAY",
                procedures=COLON,
                actor_user_id=actor.id,
                same_day_reason="당일 요청",
                same_day_preparation_confirmed=True,
                same_day_clinician_confirmed=True,
                now=FIXED_NOW,
            )
        assert captured.value.code == "SAME_DAY_UPPER_ONLY"


def test_same_day_sedation_requires_escort(
    session_factory: sessionmaker[Session],
    seeded_identity: SeededIdentity,
) -> None:
    with session_factory() as db:
        patient, actor = _patient_and_actor(db)
        with pytest.raises(ApiError) as captured:
            create_appointment(
                db,
                patient_id=patient.id,
                service_date=SERVICE_DATE,
                start_time=time(9, 30),
                care_type="GENERAL",
                booking_bucket="STANDARD_MORNING",
                booking_origin="SAME_DAY",
                procedures=[
                    AppointmentProcedureInput(
                        procedure_code="UPPER",
                        sedation_mode="SEDATED",
                    )
                ],
                actor_user_id=actor.id,
                same_day_reason="당일 요청",
                same_day_preparation_confirmed=True,
                same_day_clinician_confirmed=True,
                now=FIXED_NOW,
            )
        assert captured.value.code == "SAME_DAY_ESCORT_REQUIRED"


def test_approved_extension_slot_is_single_use_and_audited(
    session_factory: sessionmaker[Session],
    seeded_identity: SeededIdentity,
) -> None:
    with session_factory() as db:
        patient, actor = _patient_and_actor(db)
        for start in (time(9), time(9, 30), time(10), time(10, 30), time(11)):
            create_appointment(
                db,
                patient_id=patient.id,
                service_date=SERVICE_DATE,
                start_time=start,
                care_type="GENERAL",
                booking_bucket="STANDARD_MORNING",
                procedures=UPPER,
                actor_user_id=actor.id,
                now=FIXED_NOW,
            )
        slot = additional_slots.create_additional_slot(
            db,
            service_date=SERVICE_DATE,
            start_time=time(12),
            reason="합성 당일 연장 승인",
            actor_user_id=actor.id,
            now=FIXED_NOW,
        )
        appointment = create_appointment(
            db,
            patient_id=patient.id,
            service_date=SERVICE_DATE,
            start_time=time(12),
            care_type="GENERAL",
            booking_bucket="SAME_DAY_EXTENSION",
            booking_origin="SAME_DAY",
            procedures=UPPER,
            actor_user_id=actor.id,
            additional_slot_id=slot.id,
            same_day_reason="당일 진료 후 시행 결정",
            same_day_preparation_confirmed=True,
            same_day_clinician_confirmed=True,
            now=FIXED_NOW,
        )
        assert appointment.booking_origin == "SAME_DAY"
        assert appointment.additional_slot_id == slot.id
        history_reason = db.scalar(
            select(AppointmentHistoryEvent.reason).where(
                AppointmentHistoryEvent.appointment_id == appointment.id
            )
        )
        assert history_reason == "당일 위내시경 등록"

        with pytest.raises(ApiError) as captured:
            create_appointment(
                db,
                patient_id=patient.id,
                service_date=SERVICE_DATE,
                start_time=time(12),
                care_type="GENERAL",
                booking_bucket="SAME_DAY_EXTENSION",
                booking_origin="SAME_DAY",
                procedures=UPPER,
                actor_user_id=actor.id,
                additional_slot_id=slot.id,
                same_day_reason="두 번째 요청",
                same_day_preparation_confirmed=True,
                same_day_clinician_confirmed=True,
                now=FIXED_NOW,
            )
        assert captured.value.code == "ADDITIONAL_SLOT_ALREADY_USED"
