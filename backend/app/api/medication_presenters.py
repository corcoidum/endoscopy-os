from __future__ import annotations

from datetime import datetime
from uuid import UUID

from app.schemas.medication import (
    MedicationCategories,
    MedicationChecklistResponse,
    MedicationChecklistRevisionResponse,
    MedicationChecklistSnapshot,
    MedicationItemResponse,
    MedicationReviewResponse,
    PhysicianProfileResponse,
)
from app.services.medications import CATEGORY_FIELDS, ItemView, MedicationReviewStatus


def _name(names: dict[UUID, str], user_id: UUID | None) -> str | None:
    return names.get(user_id) if user_id is not None else None


def present_item(view: ItemView, status: MedicationReviewStatus) -> MedicationItemResponse:
    item = view.item
    names = status.user_names
    return MedicationItemResponse(
        id=item.id,
        item_key=item.item_key,
        revision=item.revision,
        status=item.status,
        medication_name=view.medication_name,
        decision=item.decision,
        hold_days=item.hold_days,
        rationale=view.rationale,
        physician_profile_id=item.physician_profile_id,
        physician_name=_name(status.profile_names, item.physician_profile_id),
        decided_for_service_date=item.decided_for_service_date,
        needs_re_review=(
            item.status == "ACTIVE"
            and item.decision != "PENDING"
            and item.decided_for_service_date != status.appointment.service_date
        ),
        recorded_by_user_id=item.recorded_by_user_id,
        recorded_by_name=_name(names, item.recorded_by_user_id),
        recorded_at=item.recorded_at,
        patient_notified_at=item.patient_notified_at,
        patient_notified_by_name=_name(names, item.patient_notified_by_user_id),
        hold_confirmed_on=item.hold_confirmed_on,
        hold_confirmed_at=item.hold_confirmed_at,
        hold_confirmed_by_name=_name(names, item.hold_confirmed_by_user_id),
        ended_at=item.ended_at,
        ended_by_name=_name(names, item.ended_by_user_id),
        end_reason=item.end_reason,
    )


def present_review(status: MedicationReviewStatus) -> MedicationReviewResponse:
    names = status.user_names
    checklist = None
    if status.checklist is not None:
        review = status.checklist.review
        checklist = MedicationChecklistResponse(
            medication_status=review.medication_status,
            medication_list=status.checklist.medication_list,
            categories=MedicationCategories(
                **{key: bool(getattr(review, column)) for key, column in CATEGORY_FIELDS.items()}
            ),
            surgery_history=status.checklist.surgery_history,
            cardiovascular_history=status.checklist.cardiovascular_history,
            emr_recorded=review.emr_recorded,
            confirmed_by_user_id=review.confirmed_by_user_id,
            confirmed_by_name=_name(names, review.confirmed_by_user_id),
            confirmed_at=review.confirmed_at,
            updated_by_name=_name(names, review.updated_by_user_id),
            updated_at=review.updated_at,
            row_version=review.row_version,
        )
    history = [present_item(view, status) for view in status.items]
    # 현재 약 목록은 처음 더한 순서로 보여 준다(다시 결정해도 자리가 바뀌지 않게).
    first_recorded: dict[UUID, datetime] = {}
    for item in history:
        previous = first_recorded.get(item.item_key)
        if previous is None or item.recorded_at < previous:
            first_recorded[item.item_key] = item.recorded_at
    current = sorted(
        (item for item in history if item.status == "ACTIVE"),
        key=lambda item: first_recorded[item.item_key],
    )
    return MedicationReviewResponse(
        appointment_id=status.appointment.id,
        workflow_state=status.appointment.workflow_state,
        service_date=status.appointment.service_date,
        has_colon=status.has_colon,
        state=status.state,
        checklist=checklist,
        items=current,
        item_history=history,
        checklist_history=[
            MedicationChecklistRevisionResponse(
                revision=view.revision.revision,
                snapshot=MedicationChecklistSnapshot.model_validate(view.snapshot),
                saved_by_name=_name(names, view.revision.saved_by_user_id),
                saved_at=view.revision.saved_at,
            )
            for view in status.revisions
        ],
        physicians=[
            PhysicianProfileResponse(id=profile.id, display_name=profile.display_name)
            for profile in status.physicians
        ],
    )
