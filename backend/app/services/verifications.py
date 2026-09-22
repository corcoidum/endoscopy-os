"""예약별 인적사항 1·2차 확인과 2차 확인 정정."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.exceptions import ApiError
from app.models import Appointment, Patient, PatientVerification, User
from app.services.patients import calculate_age
from app.services.verification_core import (
    ACTIVE_WORKFLOW_STATE,
    core_snapshot,
    fingerprint,
    mark_corrected,
    verification_state,
)


@dataclass(frozen=True)
class VerificationStatus:
    appointment: Appointment
    state: str
    fingerprint: str
    subject: dict[str, object]
    records: list[PatientVerification]
    user_names: dict[UUID, str]


def verification_subject(appointment: Appointment) -> dict[str, object]:
    """핵심정보에 확인 당시 계산한 나이·계산방식·기준일을 더한 Snapshot."""

    age_method = "SCREENING_YEAR_AGE" if appointment.care_type == "SCREENING" else "FULL_AGE"
    return {
        **core_snapshot(appointment),
        "computed_age": calculate_age(
            appointment.patient.birth_date,
            appointment.service_date,
            age_method,  # type: ignore[arg-type]
        ),
        "age_method": age_method,
        "age_reference_date": appointment.service_date.isoformat(),
    }


def _not_found() -> ApiError:
    return ApiError(
        status_code=404,
        code="APPOINTMENT_NOT_FOUND",
        message="예약을 찾을 수 없습니다.",
    )


def _load_appointment(db: Session, appointment_id: UUID, *, lock: bool) -> Appointment:
    appointment = db.get(Appointment, appointment_id)
    if appointment is None:
        raise _not_found()
    statement = (
        select(Appointment)
        .where(Appointment.id == appointment_id)
        .options(selectinload(Appointment.procedures), selectinload(Appointment.patient))
        .execution_options(populate_existing=True)
    )
    if lock:
        # 환자 → 예약 순서로 잠가, 확인과 환자·예약 핵심정보 변경을 한 줄로 세운다.
        # 잠금을 얻은 뒤 다시 읽어 그 사이 확정된 변경을 반영한다.
        db.scalar(
            select(Patient)
            .where(Patient.id == appointment.patient_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        statement = statement.with_for_update()
    locked = db.scalar(statement)
    if locked is None:
        raise _not_found()
    return locked


def _records(db: Session, appointment_id: UUID) -> list[PatientVerification]:
    return list(
        db.scalars(
            select(PatientVerification)
            .where(PatientVerification.appointment_id == appointment_id)
            .order_by(
                PatientVerification.verified_at.desc(),
                PatientVerification.created_at.desc(),
            )
        ).all()
    )


def _user_names(db: Session, records: list[PatientVerification]) -> dict[UUID, str]:
    user_ids = {item.verified_by_user_id for item in records} | {
        item.invalidated_by_user_id for item in records if item.invalidated_by_user_id
    }
    if not user_ids:
        return {}
    return {
        user.id: user.display_name
        for user in db.scalars(select(User).where(User.id.in_(user_ids))).all()
    }


def _status(db: Session, appointment: Appointment) -> VerificationStatus:
    records = _records(db, appointment.id)
    return VerificationStatus(
        appointment=appointment,
        state=verification_state(records),
        fingerprint=fingerprint(core_snapshot(appointment)),
        subject=verification_subject(appointment),
        records=records,
        user_names=_user_names(db, records),
    )


def get_verification_status(db: Session, appointment_id: UUID) -> VerificationStatus:
    return _status(db, _load_appointment(db, appointment_id, lock=False))


def _require_active(appointment: Appointment) -> None:
    if appointment.workflow_state != ACTIVE_WORKFLOW_STATE:
        raise ApiError(
            status_code=409,
            code="APPOINTMENT_NOT_ACTIVE",
            message="취소되었거나 No-show로 기록된 예약은 새로 확인할 수 없습니다.",
        )


def _stale() -> ApiError:
    return ApiError(
        status_code=409,
        code="VERIFICATION_STALE",
        message=(
            "화면을 연 뒤 환자·검사 정보가 바뀌었습니다. "
            "최신 정보를 다시 불러왔으니 확인한 뒤 다시 진행해 주세요."
        ),
    )


def record_verification(
    db: Session,
    *,
    appointment_id: UUID,
    stage: str,
    expected_fingerprint: str,
    method: str,
    memo: str | None,
    actor_user_id: UUID,
    now: datetime | None = None,
) -> VerificationStatus:
    """1차 또는 2차 확인을 기록한다.

    2차 확인은 유효한 1차 확인이 있고, 1차 확인자가 아닌 다른 로그인 사용자가 같은
    핵심정보를 봤을 때만 허용한다. 관리자도 이 제한을 우회할 수 없다.
    """

    appointment = _load_appointment(db, appointment_id, lock=True)
    _require_active(appointment)
    current_fingerprint = fingerprint(core_snapshot(appointment))
    if expected_fingerprint != current_fingerprint:
        raise _stale()

    valid = {item.stage: item for item in _records(db, appointment.id) if item.is_valid}
    if stage == "PRIMARY":
        if "PRIMARY" in valid:
            raise ApiError(
                status_code=409,
                code="VERIFICATION_ALREADY_DONE",
                message="이미 유효한 1차 확인이 있습니다. 최신 상태를 다시 확인해 주세요.",
            )
    else:
        primary = valid.get("PRIMARY")
        if primary is None:
            raise ApiError(
                status_code=409,
                code="PRIMARY_VERIFICATION_REQUIRED",
                message="1차 확인이 끝난 뒤에 2차 확인할 수 있습니다.",
            )
        if primary.snapshot_hash != current_fingerprint:
            raise _stale()
        if primary.verified_by_user_id == actor_user_id:
            raise ApiError(
                status_code=409,
                code="SECOND_REVIEWER_INVALID",
                message="1차 확인자와 다른 직원이 2차 확인해야 합니다. 관리자도 같은 계정으로는 2차 확인할 수 없습니다.",
            )
        if "SECONDARY" in valid:
            raise ApiError(
                status_code=409,
                code="VERIFICATION_ALREADY_DONE",
                message="이미 유효한 2차 확인이 있습니다. 최신 상태를 다시 확인해 주세요.",
            )

    subject = verification_subject(appointment)
    db.add(
        PatientVerification(
            appointment_id=appointment.id,
            stage=stage,
            is_valid=True,
            snapshot=subject,
            snapshot_hash=current_fingerprint,
            computed_age=subject["computed_age"],
            age_method=subject["age_method"],
            age_reference_date=appointment.service_date,
            appointment_row_version=appointment.row_version,
            method=method,
            memo=(memo or "").strip() or None,
            verified_by_user_id=actor_user_id,
            verified_at=now or datetime.now(UTC),
        )
    )
    db.flush()
    return _status(db, appointment)


def correct_secondary(
    db: Session,
    *,
    appointment_id: UUID,
    verification_id: UUID,
    reason: str,
    actor_user_id: UUID,
    now: datetime | None = None,
) -> VerificationStatus:
    """완료된 2차 확인을 사유와 함께 취소한다. 유효한 1차 확인은 그대로 둔다."""

    appointment = _load_appointment(db, appointment_id, lock=True)
    current = next(
        (
            item
            for item in _records(db, appointment.id)
            if item.is_valid and item.stage == "SECONDARY"
        ),
        None,
    )
    if current is None or current.id != verification_id:
        raise ApiError(
            status_code=409,
            code="VERIFICATION_STALE",
            message="이미 정정되었거나 무효가 된 2차 확인입니다. 최신 상태를 다시 확인해 주세요.",
        )
    mark_corrected(
        current,
        reason=reason.strip(),
        actor_user_id=actor_user_id,
        now=now,
    )
    db.flush()
    return _status(db, appointment)
