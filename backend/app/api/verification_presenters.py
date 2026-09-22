from __future__ import annotations

from uuid import UUID

from app.models import PatientVerification
from app.schemas.verification import (
    VerificationRecordResponse,
    VerificationStatusResponse,
    VerificationSubject,
)
from app.services.verifications import VerificationStatus


def present_record(
    item: PatientVerification, user_names: dict[UUID, str]
) -> VerificationRecordResponse:
    invalidated_by = item.invalidated_by_user_id
    return VerificationRecordResponse(
        id=item.id,
        stage=item.stage,
        is_valid=item.is_valid,
        method=item.method,
        memo=item.memo,
        verified_by_user_id=item.verified_by_user_id,
        verified_by_name=user_names.get(item.verified_by_user_id, "알 수 없는 사용자"),
        verified_at=item.verified_at,
        appointment_row_version=item.appointment_row_version,
        # 확인 당시 Snapshot을 그대로 돌려준다. 현재 원본 값으로 다시 계산하지 않는다.
        subject=VerificationSubject.model_validate(item.snapshot),
        invalidated_at=item.invalidated_at,
        invalidated_by_user_id=invalidated_by,
        invalidated_by_name=user_names.get(invalidated_by) if invalidated_by else None,
        invalidation_type=item.invalidation_type,
        invalidation_reason=item.invalidation_reason,
    )


def present_status(status: VerificationStatus) -> VerificationStatusResponse:
    records = [present_record(item, status.user_names) for item in status.records]
    by_id = {record.id: record for record in records}
    valid = {item.stage: by_id[item.id] for item in status.records if item.is_valid}
    latest_invalidated = max(
        (item for item in status.records if item.invalidated_at is not None),
        key=lambda item: item.invalidated_at or item.verified_at,
        default=None,
    )
    return VerificationStatusResponse(
        appointment_id=status.appointment.id,
        workflow_state=status.appointment.workflow_state,
        state=status.state,
        fingerprint=status.fingerprint,
        current=VerificationSubject.model_validate(status.subject),
        primary=valid.get("PRIMARY"),
        secondary=valid.get("SECONDARY"),
        last_invalidation=by_id[latest_invalidated.id] if latest_invalidated else None,
        history=records,
    )
