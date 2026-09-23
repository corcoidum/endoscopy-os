"""대장내시경 복용약·수술력 확인과 약별 의사 결정 기록(Sprint 4B).

설계 문서의 `pre_procedure_assessments`와 `medication_reviews`를 예약별
`medication_reviews` 하나로 합쳤다. 의사 확인은 약별(`medication_items`)로 남기므로
검토 단위의 의사 확인 열이 따로 필요 없다.

- 시스템은 약 중단 여부·기간을 정하지 않는다. 의사가 정한 값과 의사 Profile,
  입력한 로그인 사용자를 함께 기록한다.
- 약별 결정은 행을 고치지 않고 새 Revision으로 쌓는다. 이전 결정은
  `SUPERSEDED`, 철회는 `WITHDRAWN`으로 남긴다.
- 약 이름·복용약 목록·수술력·사유는 `pgcrypto`로 암호화한다.
- 이 기록은 예약 업무 이력이며 Sprint 7의 영구 Audit Log와는 별개다.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.iam import IAM_SCHEMA, StaffProfile

if TYPE_CHECKING:
    from app.models.appointment import Appointment

CATEGORY_COLUMNS = (
    "anticoagulant_present",
    "antiplatelet_present",
    "circulation_drug_present",
    "cardiac_drug_present",
    "neurologic_drug_present",
    "chronic_disease_drug_present",
)


def _user_fk() -> ForeignKey:
    return ForeignKey(f"{IAM_SCHEMA}.users.id", ondelete="RESTRICT")


class MedicationReview(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """예약별 복용약 확인 Checklist. 저장할 때마다 Revision Snapshot을 남긴다."""

    __tablename__ = "medication_reviews"
    __table_args__ = (
        CheckConstraint(
            "medication_status IN ('UNCHECKED','LIST_CONFIRMED','NONE_CONFIRMED')",
            name="medication_status",
        ),
        CheckConstraint(
            "medication_status <> 'LIST_CONFIRMED' "
            "OR medication_list_ciphertext IS NOT NULL",
            name="medication_list_required",
        ),
        # '복용약 없음'과 복용 분류를 함께 표시할 수 없다.
        CheckConstraint(
            "medication_status <> 'NONE_CONFIRMED' OR NOT ("
            + " OR ".join(CATEGORY_COLUMNS)
            + ")",
            name="none_without_categories",
        ),
        CheckConstraint(
            "(confirmed_by_user_id IS NULL) = (confirmed_at IS NULL)",
            name="confirmation_pair",
        ),
        CheckConstraint(
            "(medication_status = 'UNCHECKED') = (confirmed_at IS NULL)",
            name="confirmed_status",
        ),
        CheckConstraint("row_version >= 1", name="row_version_positive"),
    )

    appointment_id: Mapped[UUID] = mapped_column(
        ForeignKey("appointments.id", ondelete="RESTRICT"),
        nullable=False,
        unique=True,
        index=True,
    )
    medication_status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="UNCHECKED", server_default="UNCHECKED"
    )
    medication_list_ciphertext: Mapped[bytes | None] = mapped_column(
        LargeBinary, nullable=True
    )
    anticoagulant_present: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    antiplatelet_present: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    circulation_drug_present: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    cardiac_drug_present: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    neurologic_drug_present: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    chronic_disease_drug_present: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    surgery_history_ciphertext: Mapped[bytes | None] = mapped_column(
        LargeBinary, nullable=True
    )
    cardiovascular_history_ciphertext: Mapped[bytes | None] = mapped_column(
        LargeBinary, nullable=True
    )
    emr_recorded: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    confirmed_by_user_id: Mapped[UUID | None] = mapped_column(
        _user_fk(), nullable=True, index=True
    )
    confirmed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    updated_by_user_id: Mapped[UUID] = mapped_column(
        _user_fk(), nullable=False, index=True
    )
    row_version: Mapped[int] = mapped_column(
        Integer, nullable=False, default=1, server_default=text("1")
    )

    appointment: Mapped[Appointment] = relationship(back_populates="medication_review")
    items: Mapped[list[MedicationItem]] = relationship(
        back_populates="review",
        order_by="MedicationItem.recorded_at",
    )
    revisions: Mapped[list[MedicationReviewRevision]] = relationship(
        back_populates="review",
        order_by="MedicationReviewRevision.revision",
    )


class MedicationReviewRevision(UUIDPrimaryKeyMixin, Base):
    """Checklist 저장 시점의 전체 값. 원문은 암호화한 JSON으로 보관한다."""

    __tablename__ = "medication_review_revisions"
    __table_args__ = (
        UniqueConstraint("review_id", "revision"),
        CheckConstraint("revision >= 1", name="revision_positive"),
    )

    review_id: Mapped[UUID] = mapped_column(
        ForeignKey("medication_reviews.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    medication_status: Mapped[str] = mapped_column(String(20), nullable=False)
    snapshot_ciphertext: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    saved_by_user_id: Mapped[UUID] = mapped_column(
        _user_fk(), nullable=False, index=True
    )
    saved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    review: Mapped[MedicationReview] = relationship(back_populates="revisions")


class MedicationItem(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """중단 검토 약 한 가지의 결정 Revision.

    같은 약의 Revision은 `item_key`로 묶고, 현재 유효한 행(`ACTIVE`)은 하나뿐이다.
    환자 안내와 실제 중단 확인은 한 번만 채우는 값이며 새 결정 Revision에서는 다시
    받는다.
    """

    __tablename__ = "medication_items"
    __table_args__ = (
        Index(
            "uq_medication_items_active_item",
            "item_key",
            unique=True,
            postgresql_where=text("status = 'ACTIVE'"),
            sqlite_where=text("status = 'ACTIVE'"),
        ),
        UniqueConstraint("item_key", "revision"),
        CheckConstraint(
            "status IN ('ACTIVE','SUPERSEDED','WITHDRAWN')", name="status"
        ),
        CheckConstraint(
            "decision IN ('PENDING','HOLD','CONTINUE')", name="decision"
        ),
        CheckConstraint("revision >= 1", name="revision_positive"),
        CheckConstraint(
            "decision <> 'HOLD' OR hold_days BETWEEN 1 AND 90", name="hold_days_range"
        ),
        CheckConstraint(
            "decision = 'HOLD' OR hold_days IS NULL", name="hold_days_only_for_hold"
        ),
        CheckConstraint(
            "decision <> 'CONTINUE' OR rationale_ciphertext IS NOT NULL",
            name="continue_rationale",
        ),
        # 의사 결정이 있으면 의사 Profile과 결정 당시 검사일이 반드시 함께 남는다.
        CheckConstraint(
            "(decision = 'PENDING') = (physician_profile_id IS NULL)",
            name="physician_for_decision",
        ),
        CheckConstraint(
            "(decision = 'PENDING') = (decided_for_service_date IS NULL)",
            name="service_date_for_decision",
        ),
        CheckConstraint(
            "(patient_notified_at IS NULL) = (patient_notified_by_user_id IS NULL)",
            name="notification_pair",
        ),
        CheckConstraint(
            "decision <> 'PENDING' OR patient_notified_at IS NULL",
            name="notify_after_decision",
        ),
        CheckConstraint(
            "(hold_confirmed_on IS NULL) = (hold_confirmed_by_user_id IS NULL) "
            "AND (hold_confirmed_on IS NULL) = (hold_confirmed_at IS NULL)",
            name="hold_confirmation_triple",
        ),
        CheckConstraint(
            "decision = 'HOLD' OR hold_confirmed_on IS NULL",
            name="hold_confirmation_only_for_hold",
        ),
        CheckConstraint(
            "(status = 'ACTIVE') = (ended_at IS NULL)", name="ended_when_inactive"
        ),
        CheckConstraint(
            "(ended_at IS NULL) = (ended_by_user_id IS NULL)", name="ended_pair"
        ),
        CheckConstraint(
            "status <> 'WITHDRAWN' OR end_reason IS NOT NULL", name="withdraw_reason"
        ),
    )

    review_id: Mapped[UUID] = mapped_column(
        ForeignKey("medication_reviews.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    item_key: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False, index=True)
    revision: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="ACTIVE", server_default="ACTIVE", index=True
    )
    medication_name_ciphertext: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    decision: Mapped[str] = mapped_column(String(20), nullable=False)
    hold_days: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    rationale_ciphertext: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    physician_profile_id: Mapped[UUID | None] = mapped_column(
        ForeignKey(f"{IAM_SCHEMA}.staff_profiles.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    decided_for_service_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    recorded_by_user_id: Mapped[UUID] = mapped_column(
        _user_fk(), nullable=False, index=True
    )
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    patient_notified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    patient_notified_by_user_id: Mapped[UUID | None] = mapped_column(
        _user_fk(), nullable=True, index=True
    )
    hold_confirmed_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    hold_confirmed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    hold_confirmed_by_user_id: Mapped[UUID | None] = mapped_column(
        _user_fk(), nullable=True, index=True
    )
    ended_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    ended_by_user_id: Mapped[UUID | None] = mapped_column(
        _user_fk(), nullable=True, index=True
    )
    end_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    review: Mapped[MedicationReview] = relationship(back_populates="items")
    physician_profile: Mapped[StaffProfile | None] = relationship()
