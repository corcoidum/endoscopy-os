from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.db.session import get_session_factory
from app.models import Patient, User
from app.services.patients import create_patient


SYNTHETIC_PATIENTS = (
    {
        "chart_number": "SYN-PT-0001",
        "name": "합성가람",
        "birth_date": date(1978, 4, 12),
        "sex": "FEMALE",
    },
    {
        "chart_number": "SYN-PT-0002",
        "name": "합성나래",
        "birth_date": date(1966, 11, 3),
        "sex": "MALE",
    },
    {
        "chart_number": "SYN-PT-0003",
        "name": "합성다온",
        "birth_date": date(1989, 7, 25),
        "sex": "FEMALE",
    },
    {
        "chart_number": "SYN-PT-0004",
        "name": "합성마루",
        "birth_date": date(1959, 1, 30),
        "sex": "MALE",
    },
)


def seed_synthetic_patients(db: Session, settings: Settings) -> int:
    actor = db.scalar(
        select(User)
        .where(User.is_active.is_(True))
        .order_by(User.created_at)
    )
    if actor is None:
        raise RuntimeError("먼저 seed-identity로 관리자 계정을 생성해 주세요.")

    existing_chart_numbers = set(
        db.scalars(select(Patient.chart_number_normalized)).all()
    )
    created = 0
    for item in SYNTHETIC_PATIENTS:
        normalized = item["chart_number"].casefold()
        if normalized in existing_chart_numbers:
            continue
        create_patient(
            db,
            chart_number=item["chart_number"],
            name=item["name"],
            birth_date=item["birth_date"],
            sex=item["sex"],
            phone=None,
            special_notes=None,
            actor_user_id=actor.id,
            settings=settings,
        )
        existing_chart_numbers.add(normalized)
        created += 1
    return created


def main() -> int:
    settings = get_settings()
    with get_session_factory()() as db:
        created = seed_synthetic_patients(db, settings)
        db.commit()

    print(f"합성 환자 Seed 완료: 신규 {created}건")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
