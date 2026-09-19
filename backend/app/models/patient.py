from __future__ import annotations

from datetime import date, datetime
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
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.iam import IAM_SCHEMA


class Patient(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "patients"
    __table_args__ = (
        CheckConstraint("sex IN ('MALE','FEMALE')", name="sex"),
        CheckConstraint(
            "cancellation_count_cache >= 0",
            name="cancellation_count_nonnegative",
        ),
        CheckConstraint(
            "no_show_count_cache >= 0",
            name="no_show_count_nonnegative",
        ),
        UniqueConstraint(
            "chart_number_normalized",
            name="uq_patients_chart_number_normalized",
        ),
        Index(
            "ix_patients_demographics",
            "name",
            "birth_date",
            "sex",
        ),
    )

    chart_number: Mapped[str] = mapped_column(String(40), nullable=False)
    chart_number_normalized: Mapped[str] = mapped_column(
        String(40), nullable=False
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    birth_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    sex: Mapped[str] = mapped_column(String(10), nullable=False, index=True)
    phone_ciphertext: Mapped[bytes | None] = mapped_column(
        LargeBinary, nullable=True
    )
    special_notes_ciphertext: Mapped[bytes | None] = mapped_column(
        LargeBinary, nullable=True
    )
    cancellation_count_cache: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default=text("0"),
        index=True,
    )
    no_show_count_cache: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default=text("0"),
        index=True,
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default=text("true"),
        index=True,
    )
    deactivated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    created_by_user_id: Mapped[UUID] = mapped_column(
        ForeignKey(f"{IAM_SCHEMA}.users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    updated_by_user_id: Mapped[UUID] = mapped_column(
        ForeignKey(f"{IAM_SCHEMA}.users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    row_version: Mapped[int] = mapped_column(
        Integer, nullable=False, default=1, server_default=text("1")
    )

    history_events: Mapped[list[PatientHistoryEvent]] = relationship(
        back_populates="patient",
        cascade="all, delete-orphan",
        order_by="PatientHistoryEvent.occurred_at.desc()",
    )


class PatientHistoryEvent(UUIDPrimaryKeyMixin, Base):
    """환자 원본을 덮어써도 정정 경위를 잃지 않게 하는 Domain History."""

    __tablename__ = "patient_history_events"
    __table_args__ = (
        CheckConstraint(
            "event_type IN ('CREATED','UPDATED','DEACTIVATED','REACTIVATED')",
            name="event_type",
        ),
        Index(
            "ix_patient_history_patient_occurred",
            "patient_id",
            "occurred_at",
        ),
    )

    patient_id: Mapped[UUID] = mapped_column(
        ForeignKey("patients.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    event_type: Mapped[str] = mapped_column(
        String(20), nullable=False, index=True
    )
    changed_fields: Mapped[list[str]] = mapped_column(JSON, nullable=False)
    before_values: Mapped[dict[str, object] | None] = mapped_column(
        JSON, nullable=True
    )
    after_values: Mapped[dict[str, object]] = mapped_column(
        JSON, nullable=False
    )
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    actor_user_id: Mapped[UUID] = mapped_column(
        ForeignKey(f"{IAM_SCHEMA}.users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        index=True,
    )

    patient: Mapped[Patient] = relationship(back_populates="history_events")
