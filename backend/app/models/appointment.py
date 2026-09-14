from __future__ import annotations

from datetime import date, datetime
from uuid import UUID

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.iam import IAM_SCHEMA


class ScheduleResource(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "schedule_resources"

    code: Mapped[str] = mapped_column(String(40), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default=text("true"),
        index=True,
    )


class Appointment(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "appointments"
    __table_args__ = (
        CheckConstraint(
            "booking_bucket IN ('STANDARD_MORNING','AFTERNOON_EXCEPTION')",
            name="booking_bucket",
        ),
        CheckConstraint(
            "care_type IN ('GENERAL','SCREENING')",
            name="care_type",
        ),
        CheckConstraint(
            "workflow_state IN ('BOOKED','CANCELLED')",
            name="workflow_state",
        ),
        CheckConstraint(
            "scheduled_start_at < scheduled_end_at",
            name="valid_interval",
        ),
        Index(
            "ix_appointments_service_date_state",
            "service_date",
            "workflow_state",
        ),
    )

    patient_id: Mapped[UUID] = mapped_column(
        ForeignKey("patients.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    resource_id: Mapped[UUID] = mapped_column(
        ForeignKey("schedule_resources.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    service_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    scheduled_start_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    scheduled_end_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    booking_bucket: Mapped[str] = mapped_column(
        String(30), nullable=False, default="STANDARD_MORNING"
    )
    care_type: Mapped[str] = mapped_column(String(20), nullable=False)
    workflow_state: Mapped[str] = mapped_column(
        String(30), nullable=False, default="BOOKED", index=True
    )
    occupies_slot: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default=text("true"),
        index=True,
    )
    schedule_policy_version: Mapped[str] = mapped_column(
        String(80), nullable=False
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

    resource: Mapped[ScheduleResource] = relationship()
    patient: Mapped["Patient"] = relationship()
    procedures: Mapped[list[AppointmentProcedure]] = relationship(
        back_populates="appointment",
        cascade="all, delete-orphan",
        order_by="AppointmentProcedure.procedure_code",
    )
    history_events: Mapped[list[AppointmentHistoryEvent]] = relationship(
        back_populates="appointment",
        cascade="all, delete-orphan",
        order_by="AppointmentHistoryEvent.occurred_at.desc()",
    )


class AppointmentProcedure(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "appointment_procedures"
    __table_args__ = (
        CheckConstraint(
            "procedure_code IN ('UPPER','COLON')",
            name="procedure_code",
        ),
        CheckConstraint(
            "sedation_mode IN ('SEDATED','NON_SEDATED')",
            name="sedation_mode",
        ),
        UniqueConstraint(
            "appointment_id",
            "procedure_code",
            name="uq_appointment_procedures_appointment_code",
        ),
    )

    appointment_id: Mapped[UUID] = mapped_column(
        ForeignKey("appointments.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    procedure_code: Mapped[str] = mapped_column(
        String(20), nullable=False, index=True
    )
    sedation_mode: Mapped[str] = mapped_column(String(20), nullable=False)

    appointment: Mapped[Appointment] = relationship(back_populates="procedures")


class AppointmentHistoryEvent(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "appointment_history_events"
    __table_args__ = (
        CheckConstraint(
            "event_type IN ('CREATED','UPDATED','CANCELLED')",
            name="event_type",
        ),
        Index(
            "ix_appointment_history_appointment_occurred",
            "appointment_id",
            "occurred_at",
        ),
    )

    appointment_id: Mapped[UUID] = mapped_column(
        ForeignKey("appointments.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    event_type: Mapped[str] = mapped_column(String(20), nullable=False)
    changed_fields: Mapped[list[str]] = mapped_column(JSON, nullable=False)
    before_values: Mapped[dict[str, object] | None] = mapped_column(
        JSON, nullable=True
    )
    after_values: Mapped[dict[str, object]] = mapped_column(JSON, nullable=False)
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

    appointment: Mapped[Appointment] = relationship(back_populates="history_events")
