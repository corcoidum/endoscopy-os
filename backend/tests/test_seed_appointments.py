from datetime import date

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from app.cli.seed_appointments import (
    build_synthetic_appointment_specs,
    seed_synthetic_appointments,
)
from app.cli.seed_patients import seed_synthetic_patients
from app.models import Appointment, AppointmentHistoryEvent, ScheduleResource


def test_synthetic_appointment_specs_cover_requested_range() -> None:
    specs = build_synthetic_appointment_specs(date(2026, 9, 1), date(2026, 9, 19))

    assert len(specs) == 45
    assert min(item.service_date for item in specs) == date(2026, 9, 1)
    assert max(item.service_date for item in specs) == date(2026, 9, 19)
    assert all(item.service_date.weekday() != 6 for item in specs)
    assert len([item for item in specs if item.service_date == date(2026, 9, 18)]) == 3


def test_synthetic_appointment_seed_is_idempotent(
    session_factory: sessionmaker[Session],
    seeded_identity,
    test_settings,
) -> None:
    with session_factory() as db:
        seed_synthetic_patients(db, test_settings)
        first = seed_synthetic_appointments(db)
        db.commit()
        second = seed_synthetic_appointments(db)
        db.commit()

        assert first.created == 45
        assert first.already_present == 0
        assert first.conflicts == []
        assert second.created == 0
        assert second.already_present == 45
        assert second.conflicts == []
        assert db.scalar(select(func.count()).select_from(Appointment)) == 45
        assert (
            db.scalar(select(func.count()).select_from(AppointmentHistoryEvent))
            == 45
        )


def test_synthetic_appointment_seed_rejects_broad_range() -> None:
    with pytest.raises(ValueError, match="최대 31일"):
        build_synthetic_appointment_specs(date(2026, 9, 1), date(2026, 10, 2))


def test_synthetic_appointment_seed_restores_missing_default_resource(
    session_factory: sessionmaker[Session],
    seeded_identity,
    test_settings,
) -> None:
    with session_factory() as db:
        seed_synthetic_patients(db, test_settings)
        db.query(ScheduleResource).delete()
        db.flush()

        result = seed_synthetic_appointments(
            db,
            start_date=date(2026, 9, 18),
            end_date=date(2026, 9, 18),
        )
        db.commit()

        assert result.created == 3
        assert db.scalar(select(func.count()).select_from(ScheduleResource)) == 1
