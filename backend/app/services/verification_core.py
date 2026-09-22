"""이중확인 대상 핵심정보와 자동 무효화.

예약·환자 Service가 모두 쓰므로 Model과 시각 Helper에만 의존한다(순환 import 방지).
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import to_seoul
from app.models import Appointment, PatientVerification

ACTIVE_WORKFLOW_STATE = "BOOKED"

# 바뀌면 기존 1·2차 확인을 무효화하는 환자 핵심정보. 연락처·특이사항은 제외한다.
PATIENT_CORE_FIELDS: dict[str, str] = {
    "name": "이름",
    "chart_number": "차트번호",
    "birth_date": "생년월일",
    "sex": "성별",
}

# 바뀌면 기존 1·2차 확인을 무효화하는 예약 핵심정보.
APPOINTMENT_CORE_FIELDS: dict[str, str] = {
    "service_date": "검사일",
    "start_time": "시작시각",
    "procedures": "검사종류·수면",
    "procedure_set": "세트",
    "care_type": "일반/검진",
}

VERIFICATION_STATES = ("UNVERIFIED", "PRIMARY_DONE", "VERIFIED", "REVERIFY_REQUIRED")


def core_snapshot(appointment: Appointment) -> dict[str, object]:
    """확인 대상이 되는 환자·검사 핵심정보. 순서와 표기를 고정해 지문을 만든다."""

    patient = appointment.patient
    return {
        "patient_id": str(patient.id),
        "name": patient.name,
        "chart_number": patient.chart_number,
        "birth_date": patient.birth_date.isoformat(),
        "sex": patient.sex,
        "appointment_id": str(appointment.id),
        "service_date": appointment.service_date.isoformat(),
        "start_time": to_seoul(appointment.scheduled_start_at).strftime("%H:%M"),
        "procedures": [
            {"procedure_code": item.procedure_code, "sedation_mode": item.sedation_mode}
            for item in sorted(appointment.procedures, key=lambda item: item.procedure_code)
        ],
        "procedure_set": appointment.procedure_set,
        "care_type": appointment.care_type,
    }


def fingerprint(core: dict[str, object]) -> str:
    """핵심정보가 한 글자라도 다르면 달라지는 SHA-256 지문."""

    canonical = json.dumps(core, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def changed_core_labels(
    before: dict[str, object], after: dict[str, object], fields: dict[str, str]
) -> list[str]:
    return [label for key, label in fields.items() if before.get(key) != after.get(key)]


def verification_state(verifications: Iterable[PatientVerification]) -> str:
    """유효한 1·2차 확인과 과거 무효화 이력으로 현재 확인 상태를 정한다."""

    items = list(verifications)
    valid_stages = {item.stage for item in items if item.is_valid}
    if "PRIMARY" in valid_stages:
        return "VERIFIED" if "SECONDARY" in valid_stages else "PRIMARY_DONE"
    if any(item.invalidation_type == "CORE_CHANGED" for item in items):
        return "REVERIFY_REQUIRED"
    return "UNVERIFIED"


def _invalidate(
    items: Iterable[PatientVerification],
    *,
    invalidation_type: str,
    reason: str,
    actor_user_id: UUID,
    now: datetime | None = None,
) -> int:
    moment = now or datetime.now(UTC)
    count = 0
    for item in items:
        if not item.is_valid:
            continue
        item.is_valid = False
        item.invalidated_at = moment
        item.invalidated_by_user_id = actor_user_id
        item.invalidation_type = invalidation_type
        item.invalidation_reason = reason
        count += 1
    return count


def invalidate_appointment_verifications(
    db: Session,
    appointment_id: UUID,
    *,
    reason: str,
    actor_user_id: UUID,
    now: datetime | None = None,
) -> int:
    """예약 핵심정보가 바뀌었을 때 그 예약의 유효한 1·2차 확인을 무효로 돌린다."""

    items = db.scalars(
        select(PatientVerification).where(
            PatientVerification.appointment_id == appointment_id,
            PatientVerification.is_valid.is_(True),
        )
    ).all()
    count = _invalidate(
        items,
        invalidation_type="CORE_CHANGED",
        reason=reason,
        actor_user_id=actor_user_id,
        now=now,
    )
    db.flush()
    return count


def invalidate_patient_verifications(
    db: Session,
    patient_id: UUID,
    *,
    reason: str,
    actor_user_id: UUID,
    now: datetime | None = None,
) -> int:
    """환자 핵심정보가 바뀌었을 때 그 환자의 활성 예약에 걸린 유효 확인을 무효로 돌린다."""

    items = db.scalars(
        select(PatientVerification)
        .join(Appointment, Appointment.id == PatientVerification.appointment_id)
        .where(
            Appointment.patient_id == patient_id,
            Appointment.workflow_state == ACTIVE_WORKFLOW_STATE,
            PatientVerification.is_valid.is_(True),
        )
    ).all()
    count = _invalidate(
        items,
        invalidation_type="CORE_CHANGED",
        reason=reason,
        actor_user_id=actor_user_id,
        now=now,
    )
    db.flush()
    return count


def mark_corrected(
    item: PatientVerification,
    *,
    reason: str,
    actor_user_id: UUID,
    now: datetime | None = None,
) -> None:
    _invalidate(
        [item],
        invalidation_type="CORRECTED",
        reason=reason,
        actor_user_id=actor_user_id,
        now=now,
    )
