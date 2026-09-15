from __future__ import annotations

from datetime import date, datetime, time
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
    SmallInteger,
    String,
    Text,
    Time,
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


class ScheduleDateOverride(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """날짜별 휴진·운영시간·수용량·오후 예외 허용 Rule.

    승인된 Rule은 덮어쓰지 않고 새 Rule이 `superseded_by_id`로 대체한다.
    """

    __tablename__ = "schedule_date_overrides"
    __table_args__ = (
        CheckConstraint(
            "rule_type IN "
            "('CLOSED','OPERATING_HOURS','CAPACITY','AFTERNOON_ALLOW')",
            name="rule_type",
        ),
        CheckConstraint(
            "status IN ('PENDING','APPROVED','REVOKED','SUPERSEDED')",
            name="status",
        ),
        CheckConstraint(
            "rule_type <> 'OPERATING_HOURS' OR "
            "(override_start_time IS NOT NULL AND override_end_time IS NOT NULL "
            "AND override_start_time < override_end_time)",
            name="operating_hours_values",
        ),
        CheckConstraint(
            "rule_type <> 'CAPACITY' OR "
            "override_upper_capacity IS NOT NULL OR "
            "override_colon_capacity IS NOT NULL",
            name="capacity_values",
        ),
        CheckConstraint(
            "(override_upper_capacity IS NULL OR override_upper_capacity >= 0) "
            "AND (override_colon_capacity IS NULL OR override_colon_capacity >= 0)",
            name="capacity_non_negative",
        ),
        CheckConstraint(
            "status <> 'APPROVED' OR "
            "(approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL)",
            name="approval_metadata",
        ),
        # 같은 날짜·Resource·Rule 종류에는 승인된 Rule이 하나만 존재한다.
        Index(
            "uq_schedule_date_overrides_approved_rule",
            "resource_id",
            "service_date",
            "rule_type",
            unique=True,
            postgresql_where=text("status = 'APPROVED'"),
            sqlite_where=text("status = 'APPROVED'"),
        ),
    )

    resource_id: Mapped[UUID] = mapped_column(
        ForeignKey("schedule_resources.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    service_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    rule_type: Mapped[str] = mapped_column(String(30), nullable=False)
    override_start_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    override_end_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    override_upper_capacity: Mapped[int | None] = mapped_column(
        SmallInteger, nullable=True
    )
    override_colon_capacity: Mapped[int | None] = mapped_column(
        SmallInteger, nullable=True
    )
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="PENDING",
        server_default=text("'PENDING'"),
        index=True,
    )
    requested_by_user_id: Mapped[UUID] = mapped_column(
        ForeignKey(f"{IAM_SCHEMA}.users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    approved_by_user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey(f"{IAM_SCHEMA}.users.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    approved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    revoked_by_user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey(f"{IAM_SCHEMA}.users.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    revoke_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    superseded_by_id: Mapped[UUID | None] = mapped_column(
        ForeignKey(
            "schedule_date_overrides.id",
            name="fk_schedule_date_overrides_superseded_by_id",
            ondelete="RESTRICT",
        ),
        nullable=True,
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
            "workflow_state IN ('BOOKED','CANCELLED','NO_SHOW')",
            name="workflow_state",
        ),
        # 취소·No-show 확정 예약은 Slot을 점유하지 않는다(DEC-04).
        CheckConstraint(
            "occupies_slot = (workflow_state = 'BOOKED')",
            name="occupancy_matches_state",
        ),
        CheckConstraint(
            "booking_bucket <> 'AFTERNOON_EXCEPTION' OR "
            "(exception_reason IS NOT NULL AND "
            "exception_registered_by_user_id IS NOT NULL)",
            name="afternoon_exception_metadata",
        ),
        # 오후 예외 등록자와 확인자는 서로 다른 User여야 한다(DEC-21).
        CheckConstraint(
            "exception_confirmed_by_user_id IS NULL OR "
            "(exception_confirmed_by_user_id <> exception_registered_by_user_id "
            "AND exception_confirmed_at IS NOT NULL)",
            name="exception_confirmer_differs",
        ),
        CheckConstraint(
            "scheduled_start_at < scheduled_end_at",
            name="valid_interval",
        ),
        CheckConstraint(
            "procedure_set IS NULL OR procedure_set IN ('SET_60','SET_90')",
            name="procedure_set",
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
    procedure_set: Mapped[str | None] = mapped_column(String(20), nullable=True)
    exception_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    exception_memo: Mapped[str | None] = mapped_column(Text, nullable=True)
    exception_registered_by_user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey(f"{IAM_SCHEMA}.users.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    exception_confirmed_by_user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey(f"{IAM_SCHEMA}.users.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    exception_confirmed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
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
            "event_type IN "
            "('CREATED','UPDATED','CANCELLED','NO_SHOW','EXCEPTION_CONFIRMED')",
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
