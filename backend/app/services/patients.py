from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from datetime import UTC, date, datetime
from uuid import UUID

from sqlalchemy import ColumnElement, String, func, or_, select
from sqlalchemy.orm import Session

from app.core.clock import today_in_seoul
from app.core.config import Settings
from app.core.exceptions import ApiError
from app.models import Patient, PatientHistoryEvent, User
from app.schemas.patient import AgeMethod, SexCode
from app.services.verification_core import (
    PATIENT_CORE_FIELDS,
    invalidate_patient_verifications,
)

PHONE_PATTERN = re.compile(r"^[0-9+() -]+$")
PATIENT_EDITABLE_FIELDS = {
    "chart_number",
    "name",
    "birth_date",
    "sex",
    "phone",
    "special_notes",
}


@dataclass(frozen=True)
class PatientRecord:
    patient: Patient
    phone: str | None
    special_notes: str | None


@dataclass(frozen=True)
class PatientSearchResult:
    patients: list[Patient]
    total: int


@dataclass(frozen=True)
class PatientHistoryRecord:
    event: PatientHistoryEvent
    actor_display_name: str


def _contains_control_characters(value: str) -> bool:
    return any(unicodedata.category(character).startswith("C") for character in value)


def normalize_chart_number(value: str) -> tuple[str, str]:
    display_value = unicodedata.normalize("NFKC", value).strip()
    if not display_value or _contains_control_characters(display_value):
        raise ApiError(
            status_code=422,
            code="CHART_NUMBER_INVALID",
            message="차트번호를 확인해 주세요.",
        )
    return display_value, display_value.casefold()


def normalize_patient_name(value: str) -> str:
    normalized = unicodedata.normalize("NFC", value).strip()
    if not normalized or _contains_control_characters(normalized):
        raise ApiError(
            status_code=422,
            code="PATIENT_NAME_INVALID",
            message="환자 이름을 확인해 주세요.",
        )
    return normalized


def normalize_phone(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    if not normalized:
        return None
    if len(normalized) > 30 or not PHONE_PATTERN.fullmatch(normalized):
        raise ApiError(
            status_code=422,
            code="PATIENT_PHONE_INVALID",
            message="연락처는 숫자와 +, -, 괄호, 공백만 입력할 수 있습니다.",
        )
    return normalized


def normalize_special_notes(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    if not normalized:
        return None
    if _contains_control_characters(normalized.replace("\n", "")):
        raise ApiError(
            status_code=422,
            code="PATIENT_NOTES_INVALID",
            message="특이사항에 사용할 수 없는 문자가 포함되어 있습니다.",
        )
    return normalized


def validate_birth_date(value: date) -> None:
    # 서울 기준 오늘까지는 유효한 생년월일이다.
    if value > today_in_seoul():
        raise ApiError(
            status_code=422,
            code="BIRTH_DATE_IN_FUTURE",
            message="생년월일은 오늘 이후 날짜일 수 없습니다.",
        )


def calculate_age(
    birth_date: date,
    reference_date: date,
    method: AgeMethod,
) -> int:
    if reference_date < birth_date:
        raise ApiError(
            status_code=422,
            code="AGE_CALCULATION_INVALID",
            message="나이 기준일은 생년월일보다 빠를 수 없습니다.",
        )
    year_difference = reference_date.year - birth_date.year
    if method == "SCREENING_YEAR_AGE":
        return year_difference
    return year_difference - (
        (reference_date.month, reference_date.day)
        < (birth_date.month, birth_date.day)
    )


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def search_patients(
    db: Session,
    *,
    query: str | None,
    birth_date: date | None,
    sex: SexCode | None,
    include_inactive: bool,
    limit: int,
    offset: int,
) -> PatientSearchResult:
    filters: list[ColumnElement[bool]] = []
    if not include_inactive:
        filters.append(Patient.is_active.is_(True))
    if query and query.strip():
        raw_query = query.strip()
        escaped_query = _escape_like(raw_query)
        _, normalized_query = normalize_chart_number(raw_query)
        filters.append(
            or_(
                Patient.name.ilike(f"%{escaped_query}%", escape="\\"),
                Patient.chart_number_normalized.like(
                    f"%{_escape_like(normalized_query)}%",
                    escape="\\",
                ),
            )
        )
    if birth_date is not None:
        filters.append(Patient.birth_date == birth_date)
    if sex is not None:
        filters.append(Patient.sex == sex)

    base_statement = select(Patient).where(*filters)
    total = db.scalar(
        select(func.count()).select_from(base_statement.subquery())
    )
    patients = list(
        db.scalars(
            base_statement.order_by(
                Patient.name,
                Patient.birth_date,
                Patient.chart_number_normalized,
            )
            .limit(limit)
            .offset(offset)
        ).all()
    )
    return PatientSearchResult(patients=patients, total=int(total or 0))


def get_patient(
    db: Session,
    patient_id: UUID,
    *,
    for_update: bool = False,
) -> Patient:
    statement = select(Patient).where(Patient.id == patient_id)
    if for_update:
        statement = statement.with_for_update()
    patient = db.scalar(statement)
    if patient is None:
        raise ApiError(
            status_code=404,
            code="PATIENT_NOT_FOUND",
            message="환자정보를 찾을 수 없습니다.",
        )
    return patient


def _test_ciphertext(value: str | None) -> bytes | None:
    """SQLite Test DB는 합성 데이터만 사용하며 PostgreSQL 암호화 경로와 분리한다."""

    return value.encode("utf-8") if value is not None else None


def _encrypt_value(
    db: Session,
    value: str | None,
    settings: Settings,
):
    if value is None:
        return None
    if db.get_bind().dialect.name == "sqlite":
        return _test_ciphertext(value)
    return func.pgp_sym_encrypt(
        value,
        settings.field_encryption_key_value,
        "cipher-algo=aes256,compress-algo=0",
    )


def _decode_test_ciphertext(value: bytes | None) -> str | None:
    return value.decode("utf-8") if value is not None else None


def get_patient_record(
    db: Session,
    patient_id: UUID,
    *,
    settings: Settings,
) -> PatientRecord:
    patient = get_patient(db, patient_id)
    if db.get_bind().dialect.name == "sqlite":
        return PatientRecord(
            patient=patient,
            phone=_decode_test_ciphertext(patient.phone_ciphertext),
            special_notes=_decode_test_ciphertext(
                patient.special_notes_ciphertext
            ),
        )

    decrypted = db.execute(
        select(
            func.pgp_sym_decrypt(
                Patient.phone_ciphertext,
                settings.field_encryption_key_value,
            )
            .cast(String)
            .label("phone"),
            func.pgp_sym_decrypt(
                Patient.special_notes_ciphertext,
                settings.field_encryption_key_value,
            )
            .cast(String)
            .label("special_notes"),
        ).where(Patient.id == patient_id)
    ).one()
    return PatientRecord(
        patient=patient,
        phone=decrypted.phone,
        special_notes=decrypted.special_notes,
    )


def find_demographic_duplicates(
    db: Session,
    *,
    name: str,
    birth_date: date,
    sex: SexCode,
    exclude_patient_id: UUID | None = None,
) -> list[Patient]:
    statement = select(Patient).where(
        Patient.name == name,
        Patient.birth_date == birth_date,
        Patient.sex == sex,
    )
    if exclude_patient_id is not None:
        statement = statement.where(Patient.id != exclude_patient_id)
    return list(
        db.scalars(
            statement.order_by(
                Patient.is_active.desc(), Patient.chart_number_normalized
            )
        ).all()
    )


def chart_number_availability(
    db: Session, chart_number: str
) -> tuple[str, str, Patient | None]:
    display_value, normalized = normalize_chart_number(chart_number)
    patient = db.scalar(
        select(Patient).where(Patient.chart_number_normalized == normalized)
    )
    return display_value, normalized, patient


def _history_snapshot(
    patient: Patient,
    *,
    phone_present: bool,
    special_notes_present: bool,
) -> dict[str, object]:
    # 연락처와 특이사항 원문은 History에 다시 복제하지 않는다.
    return {
        "chart_number": patient.chart_number,
        "name": patient.name,
        "birth_date": patient.birth_date.isoformat(),
        "sex": patient.sex,
        "phone_present": phone_present,
        "special_notes_present": special_notes_present,
        "is_active": patient.is_active,
        "row_version": patient.row_version,
    }


def _add_history_event(
    db: Session,
    *,
    patient: Patient,
    event_type: str,
    changed_fields: list[str],
    before_values: dict[str, object] | None,
    after_values: dict[str, object],
    reason: str,
    actor_user_id: UUID,
) -> None:
    db.add(
        PatientHistoryEvent(
            patient=patient,
            event_type=event_type,
            changed_fields=sorted(changed_fields),
            before_values=before_values,
            after_values=after_values,
            reason=reason.strip(),
            actor_user_id=actor_user_id,
        )
    )


def create_patient(
    db: Session,
    *,
    chart_number: str,
    name: str,
    birth_date: date,
    sex: SexCode,
    phone: str | None,
    special_notes: str | None,
    actor_user_id: UUID,
    settings: Settings,
) -> tuple[PatientRecord, list[Patient]]:
    chart_display, chart_normalized, existing = chart_number_availability(
        db, chart_number
    )
    if existing is not None:
        raise ApiError(
            status_code=409,
            code="CHART_NUMBER_DUPLICATE",
            message="이미 등록된 차트번호입니다. 기존 환자를 확인해 주세요.",
        )
    normalized_name = normalize_patient_name(name)
    validate_birth_date(birth_date)
    normalized_phone = normalize_phone(phone)
    normalized_notes = normalize_special_notes(special_notes)
    duplicates = find_demographic_duplicates(
        db,
        name=normalized_name,
        birth_date=birth_date,
        sex=sex,
    )
    patient = Patient(
        chart_number=chart_display,
        chart_number_normalized=chart_normalized,
        name=normalized_name,
        birth_date=birth_date,
        sex=sex,
        phone_ciphertext=_encrypt_value(db, normalized_phone, settings),
        special_notes_ciphertext=_encrypt_value(db, normalized_notes, settings),
        created_by_user_id=actor_user_id,
        updated_by_user_id=actor_user_id,
    )
    db.add(patient)
    db.flush()
    _add_history_event(
        db,
        patient=patient,
        event_type="CREATED",
        changed_fields=[
            "chart_number",
            "name",
            "birth_date",
            "sex",
            "phone",
            "special_notes",
            "is_active",
        ],
        before_values=None,
        after_values=_history_snapshot(
            patient,
            phone_present=normalized_phone is not None,
            special_notes_present=normalized_notes is not None,
        ),
        reason="신규 환자 등록",
        actor_user_id=actor_user_id,
    )
    db.flush()
    return (
        PatientRecord(
            patient=patient,
            phone=normalized_phone,
            special_notes=normalized_notes,
        ),
        duplicates,
    )


def update_patient(
    db: Session,
    *,
    patient_id: UUID,
    row_version: int,
    reason: str,
    updates: dict[str, object],
    actor_user_id: UUID,
    settings: Settings,
) -> tuple[PatientRecord, list[Patient]]:
    patient = get_patient(db, patient_id, for_update=True)
    if patient.row_version != row_version:
        raise ApiError(
            status_code=409,
            code="PATIENT_STALE_DATA",
            message="다른 사용자가 먼저 환자정보를 변경했습니다. 새로고침 후 다시 확인해 주세요.",
        )
    current = get_patient_record(db, patient_id, settings=settings)
    requested_fields = PATIENT_EDITABLE_FIELDS.intersection(updates)
    if not requested_fields:
        raise ApiError(
            status_code=422,
            code="PATIENT_UPDATE_EMPTY",
            message="변경할 환자정보를 한 가지 이상 입력해 주세요.",
        )

    before = _history_snapshot(
        patient,
        phone_present=current.phone is not None,
        special_notes_present=current.special_notes is not None,
    )
    changed_fields: list[str] = []
    new_phone = current.phone
    new_notes = current.special_notes

    if "chart_number" in requested_fields:
        raw_chart = updates["chart_number"]
        if not isinstance(raw_chart, str):
            raise ApiError(
                status_code=422,
                code="CHART_NUMBER_INVALID",
                message="차트번호를 확인해 주세요.",
            )
        chart_display, chart_normalized, existing = chart_number_availability(
            db, raw_chart
        )
        if existing is not None and existing.id != patient.id:
            raise ApiError(
                status_code=409,
                code="CHART_NUMBER_DUPLICATE",
                message="이미 등록된 차트번호입니다. 기존 환자를 확인해 주세요.",
            )
        if patient.chart_number != chart_display:
            patient.chart_number = chart_display
            patient.chart_number_normalized = chart_normalized
            changed_fields.append("chart_number")

    if "name" in requested_fields:
        raw_name = updates["name"]
        if not isinstance(raw_name, str):
            raise ApiError(
                status_code=422,
                code="PATIENT_NAME_INVALID",
                message="환자 이름을 확인해 주세요.",
            )
        normalized_name = normalize_patient_name(raw_name)
        if patient.name != normalized_name:
            patient.name = normalized_name
            changed_fields.append("name")

    if "birth_date" in requested_fields:
        new_birth_date = updates["birth_date"]
        if not isinstance(new_birth_date, date):
            raise ApiError(
                status_code=422,
                code="BIRTH_DATE_INVALID",
                message="생년월일을 확인해 주세요.",
            )
        validate_birth_date(new_birth_date)
        if patient.birth_date != new_birth_date:
            patient.birth_date = new_birth_date
            changed_fields.append("birth_date")

    if "sex" in requested_fields:
        new_sex = updates["sex"]
        if new_sex not in ("MALE", "FEMALE"):
            raise ApiError(
                status_code=422,
                code="PATIENT_SEX_INVALID",
                message="성별을 확인해 주세요.",
            )
        if patient.sex != new_sex:
            patient.sex = str(new_sex)
            changed_fields.append("sex")

    if "phone" in requested_fields:
        raw_phone = updates["phone"]
        if raw_phone is not None and not isinstance(raw_phone, str):
            raise ApiError(
                status_code=422,
                code="PATIENT_PHONE_INVALID",
                message="연락처를 확인해 주세요.",
            )
        new_phone = normalize_phone(raw_phone)
        if current.phone != new_phone:
            patient.phone_ciphertext = _encrypt_value(
                db, new_phone, settings
            )
            changed_fields.append("phone")

    if "special_notes" in requested_fields:
        raw_notes = updates["special_notes"]
        if raw_notes is not None and not isinstance(raw_notes, str):
            raise ApiError(
                status_code=422,
                code="PATIENT_NOTES_INVALID",
                message="특이사항을 확인해 주세요.",
            )
        new_notes = normalize_special_notes(raw_notes)
        if current.special_notes != new_notes:
            patient.special_notes_ciphertext = _encrypt_value(
                db, new_notes, settings
            )
            changed_fields.append("special_notes")

    if not changed_fields:
        raise ApiError(
            status_code=422,
            code="PATIENT_UPDATE_UNCHANGED",
            message="기존 정보와 다른 변경사항이 없습니다.",
        )

    patient.updated_by_user_id = actor_user_id
    patient.row_version += 1
    db.flush()
    after = _history_snapshot(
        patient,
        phone_present=new_phone is not None,
        special_notes_present=new_notes is not None,
    )
    _add_history_event(
        db,
        patient=patient,
        event_type="UPDATED",
        changed_fields=changed_fields,
        before_values=before,
        after_values=after,
        reason=reason,
        actor_user_id=actor_user_id,
    )
    core_changed = [
        PATIENT_CORE_FIELDS[field] for field in changed_fields if field in PATIENT_CORE_FIELDS
    ]
    if core_changed:
        # 연락처·특이사항만 바뀐 경우에는 기존 확인을 유지한다.
        invalidate_patient_verifications(
            db,
            patient.id,
            reason=f"환자 핵심정보 변경({', '.join(core_changed)}): {reason.strip()}",
            actor_user_id=actor_user_id,
        )
    duplicates = find_demographic_duplicates(
        db,
        name=patient.name,
        birth_date=patient.birth_date,
        sex=patient.sex,  # type: ignore[arg-type]
        exclude_patient_id=patient.id,
    )
    return (
        PatientRecord(
            patient=patient,
            phone=new_phone,
            special_notes=new_notes,
        ),
        duplicates,
    )


def set_patient_activation(
    db: Session,
    *,
    patient_id: UUID,
    row_version: int,
    is_active: bool,
    reason: str,
    actor_user_id: UUID,
    settings: Settings,
) -> PatientRecord:
    patient = get_patient(db, patient_id, for_update=True)
    if patient.row_version != row_version:
        raise ApiError(
            status_code=409,
            code="PATIENT_STALE_DATA",
            message="다른 사용자가 먼저 환자정보를 변경했습니다. 새로고침 후 다시 확인해 주세요.",
        )
    current = get_patient_record(db, patient_id, settings=settings)
    if patient.is_active == is_active:
        raise ApiError(
            status_code=422,
            code="PATIENT_ACTIVATION_UNCHANGED",
            message="환자의 활성 상태가 이미 요청한 값과 같습니다.",
        )
    before = _history_snapshot(
        patient,
        phone_present=current.phone is not None,
        special_notes_present=current.special_notes is not None,
    )
    patient.is_active = is_active
    patient.deactivated_at = None if is_active else datetime.now(UTC)
    patient.updated_by_user_id = actor_user_id
    patient.row_version += 1
    db.flush()
    _add_history_event(
        db,
        patient=patient,
        event_type="REACTIVATED" if is_active else "DEACTIVATED",
        changed_fields=["is_active"],
        before_values=before,
        after_values=_history_snapshot(
            patient,
            phone_present=current.phone is not None,
            special_notes_present=current.special_notes is not None,
        ),
        reason=reason,
        actor_user_id=actor_user_id,
    )
    return PatientRecord(
        patient=patient,
        phone=current.phone,
        special_notes=current.special_notes,
    )


def list_patient_history(
    db: Session, patient_id: UUID
) -> list[PatientHistoryRecord]:
    get_patient(db, patient_id)
    rows = db.execute(
        select(PatientHistoryEvent, User.display_name)
        .join(User, User.id == PatientHistoryEvent.actor_user_id)
        .where(PatientHistoryEvent.patient_id == patient_id)
        .order_by(
            PatientHistoryEvent.occurred_at.desc(),
            PatientHistoryEvent.id.desc(),
        )
    ).all()
    return [
        PatientHistoryRecord(event=row[0], actor_display_name=row[1])
        for row in rows
    ]
