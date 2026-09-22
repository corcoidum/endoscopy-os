from __future__ import annotations

from datetime import date, datetime
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.iam import IAM_SCHEMA

if TYPE_CHECKING:
    from app.models.appointment import Appointment


class PatientVerification(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """예약별 인적사항 1·2차 확인.

    확인 당시 환자·검사 정보와 계산된 나이를 Snapshot으로 남긴다. 핵심정보가
    바뀌거나 2차 확인을 정정해도 행을 지우거나 덮어쓰지 않고 무효로 표시한다.
    이 기록은 예약 업무 이력이며, Sprint 7의 전체 영구 Audit Log와는 별개다.
    """

    __tablename__ = "patient_verifications"
    __table_args__ = (
        CheckConstraint("stage IN ('PRIMARY','SECONDARY')", name="stage"),
        CheckConstraint(
            "method IN ('IN_PERSON','ID_DOCUMENT','PHONE','CHART_RECORD')",
            name="method",
        ),
        CheckConstraint(
            "age_method IN ('SCREENING_YEAR_AGE','FULL_AGE')", name="age_method"
        ),
        CheckConstraint("computed_age >= 0", name="computed_age_non_negative"),
        CheckConstraint(
            "invalidation_type IS NULL OR "
            "invalidation_type IN ('CORE_CHANGED','CORRECTED')",
            name="invalidation_type",
        ),
        # 무효 행은 언제·어떤 이유로 무효가 됐는지 반드시 남긴다.
        CheckConstraint(
            "is_valid OR (invalidated_at IS NOT NULL "
            "AND invalidation_type IS NOT NULL "
            "AND invalidation_reason IS NOT NULL)",
            name="invalidation_metadata",
        ),
        CheckConstraint(
            "NOT is_valid OR (invalidated_at IS NULL AND invalidation_type IS NULL)",
            name="valid_without_invalidation",
        ),
        # 단계별로 유효한 확인은 예약마다 하나뿐이다. 무효·정정된 행은 모두 남긴다.
        Index(
            "uq_patient_verifications_valid_stage",
            "appointment_id",
            "stage",
            unique=True,
            postgresql_where=text("is_valid"),
            sqlite_where=text("is_valid = 1"),
        ),
    )

    appointment_id: Mapped[UUID] = mapped_column(
        ForeignKey("appointments.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    stage: Mapped[str] = mapped_column(String(20), nullable=False)
    is_valid: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default=text("true"),
        index=True,
    )
    snapshot: Mapped[dict[str, object]] = mapped_column(
        JSON().with_variant(JSONB(), "postgresql"), nullable=False
    )
    # 확인 대상 핵심정보의 지문. 2차 확인이 1차와 같은 정보를 봤는지 대조한다.
    snapshot_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    computed_age: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    age_method: Mapped[str] = mapped_column(String(30), nullable=False)
    age_reference_date: Mapped[date] = mapped_column(Date, nullable=False)
    appointment_row_version: Mapped[int] = mapped_column(Integer, nullable=False)
    method: Mapped[str] = mapped_column(String(30), nullable=False)
    memo: Mapped[str | None] = mapped_column(Text, nullable=True)
    verified_by_user_id: Mapped[UUID] = mapped_column(
        ForeignKey(f"{IAM_SCHEMA}.users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    verified_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    invalidated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    invalidated_by_user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey(f"{IAM_SCHEMA}.users.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    invalidation_type: Mapped[str | None] = mapped_column(String(30), nullable=True)
    invalidation_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    appointment: Mapped[Appointment] = relationship(back_populates="verifications")
