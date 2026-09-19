from __future__ import annotations

import argparse
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.cli import reject_production_environment
from app.cli.seed_identity import seed_schedule_resource
from app.core.clock import to_seoul
from app.core.config import get_settings
from app.core.exceptions import ApiError
from app.db.session import get_session_factory
from app.models import Appointment, Patient, User
from app.schemas.appointment import (
    AppointmentProcedureInput,
    CareType,
    ProcedureCode,
    ProcedureSet,
    SedationMode,
)
from app.services.appointments import create_appointment

DEFAULT_START_DATE = date(2026, 9, 1)
DEFAULT_END_DATE = date(2026, 9, 19)
MAX_SEED_DAYS = 31
SYNTHETIC_CHART_NUMBERS = tuple(f"SYN-PT-{index:04d}" for index in range(1, 5))


@dataclass(frozen=True)
class AppointmentTemplate:
    start_time: time
    procedure_codes: tuple[ProcedureCode, ...]
    sedation_modes: tuple[SedationMode, ...]
    procedure_set: ProcedureSet | None = None


@dataclass(frozen=True)
class SyntheticAppointmentSpec:
    service_date: date
    start_time: time
    chart_number: str
    care_type: CareType
    procedures: tuple[AppointmentProcedureInput, ...]
    procedure_set: ProcedureSet | None = None


@dataclass
class SeedAppointmentsResult:
    created: int = 0
    already_present: int = 0
    conflicts: list[str] = field(default_factory=list)


FULL_MORNING = (
    AppointmentTemplate(time(9, 0), ("UPPER",), ("SEDATED",)),
    AppointmentTemplate(time(9, 30), ("COLON",), ("NON_SEDATED",)),
    AppointmentTemplate(
        time(10, 30),
        ("UPPER", "COLON"),
        ("NON_SEDATED", "SEDATED"),
        "SET_60",
    ),
)
SHORT_MORNING = (
    AppointmentTemplate(time(9, 0), ("UPPER",), ("NON_SEDATED",)),
    AppointmentTemplate(time(9, 30), ("COLON",), ("SEDATED",)),
)


def _validate_date_range(start_date: date, end_date: date) -> None:
    if end_date < start_date:
        raise ValueError("종료일은 시작일보다 빠를 수 없습니다.")
    if (end_date - start_date).days + 1 > MAX_SEED_DAYS:
        raise ValueError(f"합성 예약 Seed는 한 번에 최대 {MAX_SEED_DAYS}일만 허용합니다.")


def build_synthetic_appointment_specs(
    start_date: date,
    end_date: date,
) -> list[SyntheticAppointmentSpec]:
    _validate_date_range(start_date, end_date)
    specs: list[SyntheticAppointmentSpec] = []
    current = start_date
    day_index = 0
    while current <= end_date:
        # 일요일은 원내 기본 휴진일이다.
        if current.weekday() != 6:
            templates = SHORT_MORNING if current.weekday() in {2, 5} else FULL_MORNING
            for slot_index, template in enumerate(templates):
                patient_index = (day_index + slot_index) % len(SYNTHETIC_CHART_NUMBERS)
                specs.append(
                    SyntheticAppointmentSpec(
                        service_date=current,
                        start_time=template.start_time,
                        chart_number=SYNTHETIC_CHART_NUMBERS[patient_index],
                        care_type="SCREENING" if (day_index + slot_index) % 2 == 0 else "GENERAL",
                        procedures=tuple(
                            AppointmentProcedureInput(
                                procedure_code=procedure_code,
                                sedation_mode=sedation_mode,
                            )
                            for procedure_code, sedation_mode in zip(
                                template.procedure_codes,
                                template.sedation_modes,
                                strict=True,
                            )
                        ),
                        procedure_set=template.procedure_set,
                    )
                )
            day_index += 1
        current += timedelta(days=1)
    return specs


def seed_synthetic_appointments(
    db: Session,
    *,
    start_date: date = DEFAULT_START_DATE,
    end_date: date = DEFAULT_END_DATE,
) -> SeedAppointmentsResult:
    specs = build_synthetic_appointment_specs(start_date, end_date)
    actor = db.scalar(
        select(User).where(User.is_active.is_(True)).order_by(User.created_at)
    )
    if actor is None:
        raise RuntimeError("먼저 seed-identity로 관리자 계정을 생성해 주세요.")
    seed_schedule_resource(db)

    patients = {
        patient.chart_number: patient
        for patient in db.scalars(
            select(Patient).where(Patient.chart_number.in_(SYNTHETIC_CHART_NUMBERS))
        ).all()
    }
    missing = sorted(set(SYNTHETIC_CHART_NUMBERS) - set(patients))
    if missing:
        raise RuntimeError(
            "먼저 seed-patients를 실행해 주세요. 누락: " + ", ".join(missing)
        )

    existing = list(
        db.scalars(
            select(Appointment)
            .where(
                Appointment.service_date >= start_date,
                Appointment.service_date <= end_date,
            )
            .options(selectinload(Appointment.procedures))
        ).all()
    )
    existing_keys = {
        (
            appointment.patient_id,
            appointment.service_date,
            to_seoul(appointment.scheduled_start_at).time().replace(tzinfo=None),
        )
        for appointment in existing
    }

    result = SeedAppointmentsResult()
    for spec in specs:
        patient = patients[spec.chart_number]
        key = (patient.id, spec.service_date, spec.start_time)
        if key in existing_keys:
            result.already_present += 1
            continue
        try:
            create_appointment(
                db,
                patient_id=patient.id,
                service_date=spec.service_date,
                start_time=spec.start_time,
                care_type=spec.care_type,
                booking_bucket="STANDARD_MORNING",
                booking_origin="ADVANCE",
                procedures=list(spec.procedures),
                procedure_set=spec.procedure_set,
                actor_user_id=actor.id,
                # 이 명령은 명시적으로 요청한 합성 과거 일정을 재현한다. 일반 API의
                # 과거 날짜 차단은 유지하고 Seeder 호출에만 해당 날짜 기준시각을 준다.
                now=datetime.combine(spec.service_date, time.min, tzinfo=UTC),
            )
        except ApiError as error:
            result.conflicts.append(
                f"{spec.service_date.isoformat()} {spec.start_time.strftime('%H:%M')} "
                f"{spec.chart_number}: {error.code}"
            )
            continue
        existing_keys.add(key)
        result.created += 1
    return result


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="주간표 테스트용 합성 예약을 Backend DB에 중복 없이 생성합니다."
    )
    parser.add_argument(
        "--start-date",
        type=date.fromisoformat,
        default=DEFAULT_START_DATE,
        help="시작일 YYYY-MM-DD (기본 2026-09-01)",
    )
    parser.add_argument(
        "--end-date",
        type=date.fromisoformat,
        default=DEFAULT_END_DATE,
        help="종료일 YYYY-MM-DD (기본 2026-09-19)",
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    reject_production_environment(get_settings(), "합성 예약 Seed")
    with get_session_factory()() as db:
        try:
            result = seed_synthetic_appointments(
                db,
                start_date=args.start_date,
                end_date=args.end_date,
            )
            db.commit()
        except Exception:
            db.rollback()
            raise

    print(
        "합성 예약 Seed 완료: "
        f"신규 {result.created}건, 기존 {result.already_present}건, "
        f"충돌 건너뜀 {len(result.conflicts)}건"
    )
    for conflict in result.conflicts:
        print(f"- {conflict}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
