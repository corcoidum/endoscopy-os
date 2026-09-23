"""대장내시경 복용약 확인과 약별 의사 결정(Sprint 4B, PRD MED-002~005).

- 시스템은 약 중단 여부나 기간을 정하거나 권하지 않는다. 의사가 정한 값을 결정한
  의사 Profile, 입력한 로그인 사용자와 함께 기록한다.
- 결정은 약별 Revision으로 쌓는다. 검사일이 바뀌면 기존 결정은 그대로 두고
  `재검토 필요`로 보여 주며, 새 결정은 사람이 다시 기록해야 한다.
- 환자 안내와 실제 중단 확인은 현재 검사일에 맞는 의사 결정 뒤에만 기록한다.
- 쓰기는 예약 행을 잠가 같은 예약의 복용약 기록과 예약 변경을 한 줄로 세운다.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Literal
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.clock import today_in_seoul
from app.core.config import Settings
from app.core.exceptions import ApiError
from app.models import (
    Appointment,
    MedicationItem,
    MedicationReview,
    MedicationReviewRevision,
    StaffProfile,
    User,
)
from app.models.medication import CATEGORY_COLUMNS
from app.services.field_crypto import (
    decode_test_ciphertext,
    decrypted,
    encrypt_text,
    uses_test_ciphertext,
)
from app.services.staff_profiles import PHYSICIAN_STAFF_TYPE, active_physicians

ACTIVE_WORKFLOW_STATE = "BOOKED"

MedicationState = Literal[
    "NOT_REQUIRED",
    "CHECK_REQUIRED",
    "PHYSICIAN_REQUIRED",
    "RE_REVIEW_REQUIRED",
    "NOTIFICATION_REQUIRED",
    "COMPLETE",
]

# API의 분류 이름과 저장 열을 잇는다.
CATEGORY_FIELDS: dict[str, str] = dict(
    zip(
        (
            "anticoagulant",
            "antiplatelet",
            "circulation",
            "cardiac",
            "neurologic",
            "chronic_disease",
        ),
        CATEGORY_COLUMNS,
        strict=True,
    )
)


@dataclass(frozen=True)
class ChecklistInput:
    medication_status: str
    medication_list: str | None
    categories: dict[str, bool]
    surgery_history: str | None
    cardiovascular_history: str | None
    emr_recorded: bool


@dataclass(frozen=True)
class DecisionInput:
    decision: str
    hold_days: int | None
    rationale: str | None
    physician_profile_id: UUID
    physician_confirmed: bool


@dataclass(frozen=True)
class ChecklistView:
    review: MedicationReview
    medication_list: str | None
    surgery_history: str | None
    cardiovascular_history: str | None


@dataclass(frozen=True)
class ItemView:
    item: MedicationItem
    medication_name: str
    rationale: str | None


@dataclass(frozen=True)
class RevisionView:
    revision: MedicationReviewRevision
    snapshot: dict[str, object]


@dataclass(frozen=True)
class MedicationReviewStatus:
    appointment: Appointment
    state: str
    has_colon: bool
    checklist: ChecklistView | None
    items: list[ItemView]
    revisions: list[RevisionView]
    physicians: list[StaffProfile]
    user_names: dict[UUID, str]
    profile_names: dict[UUID, str]


def has_colon(appointment: Appointment) -> bool:
    return any(item.procedure_code == "COLON" for item in appointment.procedures)


def _state(
    appointment: Appointment,
    review: MedicationReview | None,
    items: list[MedicationItem],
) -> str:
    colon = has_colon(appointment)
    active = [item for item in items if item.status == "ACTIVE"]
    unchecked = review is None or review.medication_status == "UNCHECKED"
    if unchecked and colon:
        return "CHECK_REQUIRED"
    if unchecked and not active:
        return "NOT_REQUIRED"
    if any(item.decision == "PENDING" for item in active):
        return "PHYSICIAN_REQUIRED"
    if any(item.decided_for_service_date != appointment.service_date for item in active):
        return "RE_REVIEW_REQUIRED"
    if any(item.patient_notified_at is None for item in active):
        return "NOTIFICATION_REQUIRED"
    return "COMPLETE"


def medication_state(appointment: Appointment) -> str:
    """예약 목록용 상태. `medication_review.items`가 함께 로드돼 있어야 한다."""

    review = appointment.medication_review
    return _state(appointment, review, list(review.items) if review is not None else [])


def _clean(value: str | None) -> str | None:
    text = (value or "").strip()
    return text or None


def _seoul_date(value: datetime) -> date:
    # SQLite는 Offset을 버리므로 저장할 때 쓴 UTC로 되돌린다.
    return today_in_seoul(value if value.tzinfo is not None else value.replace(tzinfo=UTC))


def _not_found() -> ApiError:
    return ApiError(
        status_code=404,
        code="APPOINTMENT_NOT_FOUND",
        message="예약을 찾을 수 없습니다.",
    )


def _load_appointment(db: Session, appointment_id: UUID, *, lock: bool) -> Appointment:
    statement = (
        select(Appointment)
        .where(Appointment.id == appointment_id)
        .options(selectinload(Appointment.procedures))
        .execution_options(populate_existing=True)
    )
    if lock:
        statement = statement.with_for_update()
    appointment = db.scalar(statement)
    if appointment is None:
        raise _not_found()
    return appointment


def _require_active(appointment: Appointment) -> None:
    if appointment.workflow_state != ACTIVE_WORKFLOW_STATE:
        raise ApiError(
            status_code=409,
            code="APPOINTMENT_NOT_ACTIVE",
            message="취소되었거나 No-show로 기록된 예약에는 복용약 기록을 더할 수 없습니다.",
        )


def _review(db: Session, appointment_id: UUID) -> MedicationReview | None:
    return db.scalar(
        select(MedicationReview)
        .where(MedicationReview.appointment_id == appointment_id)
        .execution_options(populate_existing=True)
    )


def _item_rows(db: Session, review_id: UUID) -> list[MedicationItem]:
    return list(
        db.scalars(
            select(MedicationItem)
            .where(MedicationItem.review_id == review_id)
            .order_by(MedicationItem.recorded_at.desc(), MedicationItem.revision.desc())
            .execution_options(populate_existing=True)
        ).all()
    )


def _checklist_view(
    db: Session, review: MedicationReview, settings: Settings
) -> ChecklistView:
    if uses_test_ciphertext(db):
        return ChecklistView(
            review=review,
            medication_list=decode_test_ciphertext(review.medication_list_ciphertext),
            surgery_history=decode_test_ciphertext(review.surgery_history_ciphertext),
            cardiovascular_history=decode_test_ciphertext(
                review.cardiovascular_history_ciphertext
            ),
        )
    row = db.execute(
        select(
            decrypted(MedicationReview.medication_list_ciphertext, settings).label(
                "medication_list"
            ),
            decrypted(MedicationReview.surgery_history_ciphertext, settings).label(
                "surgery_history"
            ),
            decrypted(MedicationReview.cardiovascular_history_ciphertext, settings).label(
                "cardiovascular_history"
            ),
        ).where(MedicationReview.id == review.id)
    ).one()
    return ChecklistView(
        review=review,
        medication_list=row.medication_list,
        surgery_history=row.surgery_history,
        cardiovascular_history=row.cardiovascular_history,
    )


def _item_views(
    db: Session, review_id: UUID, items: list[MedicationItem], settings: Settings
) -> list[ItemView]:
    if not items:
        return []
    if uses_test_ciphertext(db):
        return [
            ItemView(
                item=item,
                medication_name=decode_test_ciphertext(item.medication_name_ciphertext) or "",
                rationale=decode_test_ciphertext(item.rationale_ciphertext),
            )
            for item in items
        ]
    rows = db.execute(
        select(
            MedicationItem.id,
            decrypted(MedicationItem.medication_name_ciphertext, settings).label("name"),
            decrypted(MedicationItem.rationale_ciphertext, settings).label("rationale"),
        ).where(MedicationItem.review_id == review_id)
    ).all()
    plain = {row.id: row for row in rows}
    return [
        ItemView(
            item=item,
            medication_name=plain[item.id].name or "",
            rationale=plain[item.id].rationale,
        )
        for item in items
    ]


def _revision_views(
    db: Session, review_id: UUID, settings: Settings
) -> list[RevisionView]:
    revisions = list(
        db.scalars(
            select(MedicationReviewRevision)
            .where(MedicationReviewRevision.review_id == review_id)
            .order_by(MedicationReviewRevision.revision.desc())
        ).all()
    )
    if not revisions:
        return []
    if uses_test_ciphertext(db):
        texts = {
            item.id: decode_test_ciphertext(item.snapshot_ciphertext) for item in revisions
        }
    else:
        rows = db.execute(
            select(
                MedicationReviewRevision.id,
                decrypted(MedicationReviewRevision.snapshot_ciphertext, settings).label(
                    "snapshot"
                ),
            ).where(MedicationReviewRevision.review_id == review_id)
        ).all()
        texts = {row.id: row.snapshot for row in rows}
    return [
        RevisionView(revision=item, snapshot=json.loads(texts[item.id] or "{}"))
        for item in revisions
    ]


def _status(
    db: Session, appointment: Appointment, settings: Settings
) -> MedicationReviewStatus:
    review = _review(db, appointment.id)
    items = _item_rows(db, review.id) if review is not None else []
    revisions = _revision_views(db, review.id, settings) if review is not None else []
    user_ids: set[UUID] = set()
    if review is not None:
        user_ids.add(review.updated_by_user_id)
        if review.confirmed_by_user_id is not None:
            user_ids.add(review.confirmed_by_user_id)
    for item in items:
        user_ids.update(
            value
            for value in (
                item.recorded_by_user_id,
                item.patient_notified_by_user_id,
                item.hold_confirmed_by_user_id,
                item.ended_by_user_id,
            )
            if value is not None
        )
    user_ids.update(view.revision.saved_by_user_id for view in revisions)
    profile_ids = {
        item.physician_profile_id for item in items if item.physician_profile_id is not None
    }
    user_names = (
        {
            user.id: user.display_name
            for user in db.scalars(select(User).where(User.id.in_(user_ids))).all()
        }
        if user_ids
        else {}
    )
    profile_names = (
        {
            profile.id: profile.display_name
            for profile in db.scalars(
                select(StaffProfile).where(StaffProfile.id.in_(profile_ids))
            ).all()
        }
        if profile_ids
        else {}
    )
    return MedicationReviewStatus(
        appointment=appointment,
        state=_state(appointment, review, items),
        has_colon=has_colon(appointment),
        checklist=_checklist_view(db, review, settings) if review is not None else None,
        items=_item_views(db, review.id, items, settings) if review is not None else [],
        revisions=revisions,
        physicians=active_physicians(db),
        user_names=user_names,
        profile_names=profile_names,
    )


def get_medication_review(
    db: Session, appointment_id: UUID, *, settings: Settings
) -> MedicationReviewStatus:
    return _status(db, _load_appointment(db, appointment_id, lock=False), settings)


def _stale_review() -> ApiError:
    return ApiError(
        status_code=409,
        code="MEDICATION_REVIEW_STALE",
        message="다른 사용자가 먼저 복용약 확인을 저장했습니다. 최신 내용을 확인한 뒤 다시 저장해 주세요.",
    )


def _validate_checklist(checklist: ChecklistInput, active: list[MedicationItem]) -> None:
    if checklist.medication_status == "LIST_CONFIRMED" and not _clean(
        checklist.medication_list
    ):
        raise ApiError(
            status_code=422,
            code="MEDICATION_LIST_REQUIRED",
            message="복용약 목록 확인을 완료하려면 전체 복용약 목록을 기록해 주세요.",
        )
    if checklist.medication_status == "NONE_CONFIRMED":
        if any(checklist.categories.values()):
            raise ApiError(
                status_code=422,
                code="MEDICATION_NONE_CONFLICT",
                message="‘복용약 없음’과 복용 분류를 함께 표시할 수 없습니다.",
            )
        if active:
            raise ApiError(
                status_code=409,
                code="MEDICATION_ITEMS_EXIST",
                message="중단 검토 약이 남아 있어 ‘복용약 없음’으로 바꿀 수 없습니다. 먼저 그 약을 철회해 주세요.",
            )


def save_checklist(
    db: Session,
    *,
    appointment_id: UUID,
    expected_row_version: int | None,
    checklist: ChecklistInput,
    actor_user_id: UUID,
    settings: Settings,
    now: datetime | None = None,
) -> MedicationReviewStatus:
    """복용약 확인 Checklist를 저장하고, 저장한 전체 값을 Revision으로 남긴다."""

    now = now or datetime.now(UTC)
    appointment = _load_appointment(db, appointment_id, lock=True)
    _require_active(appointment)
    review = _review(db, appointment.id)
    if review is None:
        if expected_row_version:
            raise _stale_review()
        active: list[MedicationItem] = []
    else:
        if expected_row_version != review.row_version:
            raise _stale_review()
        active = [item for item in _item_rows(db, review.id) if item.status == "ACTIVE"]
    _validate_checklist(checklist, active)

    if review is None:
        review = MedicationReview(
            appointment_id=appointment.id,
            updated_by_user_id=actor_user_id,
            row_version=1,
        )
        db.add(review)
    else:
        review.row_version += 1
    medication_list = _clean(checklist.medication_list)
    surgery_history = _clean(checklist.surgery_history)
    cardiovascular_history = _clean(checklist.cardiovascular_history)
    categories = {key: bool(checklist.categories.get(key)) for key in CATEGORY_FIELDS}
    confirmed = checklist.medication_status != "UNCHECKED"
    review.medication_status = checklist.medication_status
    review.medication_list_ciphertext = encrypt_text(db, medication_list, settings)
    for key, column in CATEGORY_FIELDS.items():
        setattr(review, column, categories[key])
    review.surgery_history_ciphertext = encrypt_text(db, surgery_history, settings)
    review.cardiovascular_history_ciphertext = encrypt_text(
        db, cardiovascular_history, settings
    )
    review.emr_recorded = checklist.emr_recorded
    review.confirmed_by_user_id = actor_user_id if confirmed else None
    review.confirmed_at = now if confirmed else None
    review.updated_by_user_id = actor_user_id
    db.flush()

    snapshot = {
        "medication_status": checklist.medication_status,
        "medication_list": medication_list,
        "categories": categories,
        "surgery_history": surgery_history,
        "cardiovascular_history": cardiovascular_history,
        "emr_recorded": checklist.emr_recorded,
    }
    db.add(
        MedicationReviewRevision(
            review_id=review.id,
            revision=review.row_version,
            medication_status=checklist.medication_status,
            snapshot_ciphertext=encrypt_text(
                db, json.dumps(snapshot, ensure_ascii=False, sort_keys=True), settings
            ),
            saved_by_user_id=actor_user_id,
            saved_at=now,
        )
    )
    db.flush()
    return _status(db, appointment, settings)


def _require_review(db: Session, appointment: Appointment) -> MedicationReview:
    review = _review(db, appointment.id)
    if review is None:
        raise ApiError(
            status_code=409,
            code="MEDICATION_CHECKLIST_REQUIRED",
            message="먼저 복용약 확인 내용을 저장해 주세요.",
        )
    return review


def _physician(db: Session, profile_id: UUID) -> StaffProfile:
    profile = db.get(StaffProfile, profile_id)
    if (
        profile is None
        or profile.staff_type != PHYSICIAN_STAFF_TYPE
        or not profile.is_active
    ):
        raise ApiError(
            status_code=422,
            code="PHYSICIAN_CONFIRMATION_INVALID",
            message="결정한 의사를 확인할 수 없습니다. 활성 의사 Profile이 필요합니다.",
        )
    return profile


def _apply_decision(
    db: Session,
    item: MedicationItem,
    decision: DecisionInput,
    appointment: Appointment,
    settings: Settings,
) -> None:
    if not decision.physician_confirmed:
        raise ApiError(
            status_code=422,
            code="PHYSICIAN_CONFIRMATION_REQUIRED",
            message="담당 의사가 결정한 내용인지 확인해 주세요.",
        )
    physician = _physician(db, decision.physician_profile_id)
    rationale = _clean(decision.rationale)
    if decision.decision == "HOLD":
        if decision.hold_days is None or not 1 <= decision.hold_days <= 90:
            raise ApiError(
                status_code=422,
                code="MEDICATION_HOLD_DAYS_INVALID",
                message="의사가 정한 중단 일수를 1~90일 사이로 입력해 주세요.",
            )
        item.hold_days = decision.hold_days
    else:
        if rationale is None:
            raise ApiError(
                status_code=422,
                code="MEDICATION_RATIONALE_REQUIRED",
                message="복용을 지속하는 결정에는 의사가 밝힌 사유가 필요합니다.",
            )
        item.hold_days = None
    item.decision = decision.decision
    item.rationale_ciphertext = encrypt_text(db, rationale, settings)
    item.physician_profile_id = physician.id
    item.decided_for_service_date = appointment.service_date


def add_item(
    db: Session,
    *,
    appointment_id: UUID,
    medication_name: str,
    decision: DecisionInput | None,
    actor_user_id: UUID,
    settings: Settings,
    now: datetime | None = None,
) -> MedicationReviewStatus:
    """중단 검토 약을 더한다. 의사 결정을 함께 받으면 바로 결정으로 기록한다."""

    now = now or datetime.now(UTC)
    appointment = _load_appointment(db, appointment_id, lock=True)
    _require_active(appointment)
    review = _require_review(db, appointment)
    if review.medication_status == "NONE_CONFIRMED":
        raise ApiError(
            status_code=409,
            code="MEDICATION_NONE_CONFIRMED",
            message="‘복용약 없음’으로 확인된 예약입니다. 약을 더하려면 먼저 복용약 확인을 바꿔 주세요.",
        )
    item = MedicationItem(
        review_id=review.id,
        item_key=uuid4(),
        revision=1,
        status="ACTIVE",
        medication_name_ciphertext=encrypt_text(db, medication_name.strip(), settings),
        decision="PENDING",
        recorded_by_user_id=actor_user_id,
        recorded_at=now,
    )
    if decision is not None:
        _apply_decision(db, item, decision, appointment, settings)
    db.add(item)
    db.flush()
    return _status(db, appointment, settings)


def _current_item(
    db: Session, review: MedicationReview, item_key: UUID, expected_revision: int
) -> MedicationItem:
    rows = [item for item in _item_rows(db, review.id) if item.item_key == item_key]
    if not rows:
        raise ApiError(
            status_code=404,
            code="MEDICATION_ITEM_NOT_FOUND",
            message="중단 검토 약을 찾을 수 없습니다.",
        )
    current = next((item for item in rows if item.status == "ACTIVE"), None)
    if current is None or current.revision != expected_revision:
        raise ApiError(
            status_code=409,
            code="MEDICATION_ITEM_STALE",
            message="다른 사용자가 먼저 이 약의 기록을 바꿨거나 철회했습니다. 최신 내용을 확인해 주세요.",
        )
    return current


def _require_current_decision(item: MedicationItem, appointment: Appointment) -> None:
    if item.decision == "PENDING":
        raise ApiError(
            status_code=409,
            code="MEDICATION_DECISION_REQUIRED",
            message="의사 결정을 기록한 뒤에 진행할 수 있습니다.",
        )
    if item.decided_for_service_date != appointment.service_date:
        raise ApiError(
            status_code=409,
            code="MEDICATION_RE_REVIEW_REQUIRED",
            message="검사일이 바뀌어 의사 재검토가 필요합니다. 새 결정을 기록한 뒤 진행해 주세요.",
        )


def record_decision(
    db: Session,
    *,
    appointment_id: UUID,
    item_key: UUID,
    expected_revision: int,
    decision: DecisionInput,
    actor_user_id: UUID,
    settings: Settings,
    now: datetime | None = None,
) -> MedicationReviewStatus:
    """의사 결정을 새 Revision으로 기록한다. 이전 결정과 안내 기록은 그대로 남는다."""

    now = now or datetime.now(UTC)
    appointment = _load_appointment(db, appointment_id, lock=True)
    _require_active(appointment)
    review = _require_review(db, appointment)
    current = _current_item(db, review, item_key, expected_revision)
    replacement = MedicationItem(
        review_id=review.id,
        item_key=item_key,
        revision=current.revision + 1,
        status="ACTIVE",
        medication_name_ciphertext=current.medication_name_ciphertext,
        decision="PENDING",
        recorded_by_user_id=actor_user_id,
        recorded_at=now,
    )
    _apply_decision(db, replacement, decision, appointment, settings)
    current.status = "SUPERSEDED"
    current.ended_at = now
    current.ended_by_user_id = actor_user_id
    # 유효 Revision은 하나뿐이므로 이전 행을 먼저 내린 뒤 새 행을 넣는다.
    db.flush()
    db.add(replacement)
    db.flush()
    return _status(db, appointment, settings)


def withdraw_item(
    db: Session,
    *,
    appointment_id: UUID,
    item_key: UUID,
    expected_revision: int,
    reason: str,
    actor_user_id: UUID,
    settings: Settings,
    now: datetime | None = None,
) -> MedicationReviewStatus:
    """잘못 넣었거나 복용하지 않는 약을 사유와 함께 철회한다. 기록은 지우지 않는다."""

    now = now or datetime.now(UTC)
    appointment = _load_appointment(db, appointment_id, lock=True)
    _require_active(appointment)
    review = _require_review(db, appointment)
    current = _current_item(db, review, item_key, expected_revision)
    current.status = "WITHDRAWN"
    current.ended_at = now
    current.ended_by_user_id = actor_user_id
    current.end_reason = reason.strip()
    db.flush()
    return _status(db, appointment, settings)


def notify_patient(
    db: Session,
    *,
    appointment_id: UUID,
    item_key: UUID,
    expected_revision: int,
    actor_user_id: UUID,
    settings: Settings,
    now: datetime | None = None,
) -> MedicationReviewStatus:
    """현재 검사일에 맞는 의사 결정을 환자에게 안내했음을 기록한다."""

    now = now or datetime.now(UTC)
    appointment = _load_appointment(db, appointment_id, lock=True)
    _require_active(appointment)
    review = _require_review(db, appointment)
    current = _current_item(db, review, item_key, expected_revision)
    _require_current_decision(current, appointment)
    if current.patient_notified_at is not None:
        raise ApiError(
            status_code=409,
            code="MEDICATION_ALREADY_NOTIFIED",
            message="이미 환자 안내를 기록했습니다.",
        )
    current.patient_notified_at = now
    current.patient_notified_by_user_id = actor_user_id
    db.flush()
    return _status(db, appointment, settings)


def confirm_hold(
    db: Session,
    *,
    appointment_id: UUID,
    item_key: UUID,
    expected_revision: int,
    confirmed_on: date,
    actor_user_id: UUID,
    settings: Settings,
    now: datetime | None = None,
) -> MedicationReviewStatus:
    """중단으로 결정된 약을 환자가 실제로 중단했는지 확인한 날을 기록한다."""

    now = now or datetime.now(UTC)
    appointment = _load_appointment(db, appointment_id, lock=True)
    _require_active(appointment)
    review = _require_review(db, appointment)
    current = _current_item(db, review, item_key, expected_revision)
    if current.decision != "HOLD":
        raise ApiError(
            status_code=409,
            code="MEDICATION_HOLD_REQUIRED",
            message="중단으로 결정된 약만 실제 중단을 확인할 수 있습니다.",
        )
    _require_current_decision(current, appointment)
    if current.hold_confirmed_on is not None:
        raise ApiError(
            status_code=409,
            code="MEDICATION_HOLD_ALREADY_CONFIRMED",
            message="이미 실제 중단 확인을 기록했습니다.",
        )
    latest = min(today_in_seoul(now), appointment.service_date)
    if not _seoul_date(current.recorded_at) <= confirmed_on <= latest:
        raise ApiError(
            status_code=422,
            code="HOLD_CONFIRMATION_DATE_INVALID",
            message="실제 중단 확인일은 의사 결정일부터 오늘·검사일 사이여야 합니다.",
        )
    current.hold_confirmed_on = confirmed_on
    current.hold_confirmed_at = now
    current.hold_confirmed_by_user_id = actor_user_id
    db.flush()
    return _status(db, appointment, settings)
