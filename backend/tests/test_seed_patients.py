from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from app.cli.seed_patients import (
    SYNTHETIC_PATIENTS,
    seed_synthetic_patients,
)
from app.core.config import Settings
from app.models import Patient, PatientHistoryEvent


def test_synthetic_patient_seed_is_idempotent(
    session_factory: sessionmaker[Session],
    seeded_identity,
    test_settings: Settings,
) -> None:
    with session_factory() as db:
        assert seed_synthetic_patients(db, test_settings) == len(
            SYNTHETIC_PATIENTS
        )
        db.commit()
        assert seed_synthetic_patients(db, test_settings) == 0
        db.commit()

        assert db.scalar(select(func.count()).select_from(Patient)) == 4
        assert (
            db.scalar(select(func.count()).select_from(PatientHistoryEvent))
            == 4
        )
        assert all(
            patient.chart_number.startswith("SYN-PT-")
            for patient in db.scalars(select(Patient)).all()
        )
        assert all(
            patient.phone_ciphertext is None
            for patient in db.scalars(select(Patient)).all()
        )
