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


class ScheduleAdditionalSlot(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """관리자가 당일 위내시경을 위해 승인한 일회성 30분 연장 Slot."""

    __tablename__ = "schedule_additional_slots"
    __table_args__ = (
        CheckConstraint(
            "status IN ('APPROVED','REVOKED')",
            name="status",
        ),
        CheckConstraint(
            "start_time < end_time",
            name="valid_interval",
        ),
        CheckConstraint(
            "status <> 'REVOKED' OR "
            "(revoked_by_user_id IS NOT NULL AND revoked_at IS NOT NULL "
            "AND revoke_reason IS NOT NULL)",
            name="revocation_metadata",
        ),
        UniqueConstraint(
            "resource_id",
            "service_date",
            "start_time",
            name="uq_schedule_additional_slots_resource_date_start",
        ),
    )

    resource_id: Mapped[UUID] = mapped_column(
        ForeignKey("schedule_resources.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    service_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_time: Mapped[time] = mapped_column(Time, nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="APPROVED",
        server_default=text("'APPROVED'"),
        index=True,
    )
    approved_by_user_id: Mapped[UUID] = mapped_column(
        ForeignKey(f"{IAM_SCHEMA}.users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    approved_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
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

    resource: Mapped[ScheduleResource] = relationship()


class Appointment(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "appointments"
    __table_args__ = (
        CheckConstraint(
            "booking_bucket IN "
            "('STANDARD_MORNING','AFTERNOON_EXCEPTION','SAME_DAY_EXTENSION')",
            name="booking_bucket",
        ),
        CheckConstraint(
            "booking_origin IN ('ADVANCE','SAME_DAY')",
            name="booking_origin",
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
        CheckConstraint(
            "(booking_bucket = 'SAME_DAY_EXTENSION' AND additional_slot_id IS NOT NULL) "
            "OR (booking_bucket <> 'SAME_DAY_EXTENSION' AND additional_slot_id IS NULL)",
            name="additional_slot_matches_bucket",
        ),
        CheckConstraint(
            "booking_origin <> 'SAME_DAY' OR "
            "(same_day_reason IS NOT NULL AND same_day_preparation_confirmed = true "
            "AND same_day_clinician_confirmed = true "
            "AND same_day_confirmed_at IS NOT NULL)",
            name="same_day_confirmation_metadata",
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
    booking_origin: Mapped[str] = mapped_column(
        String(20), nullable=False, default="ADVANCE", server_default=text("'ADVANCE'")
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
    additional_slot_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("schedule_additional_slots.id", ondelete="RESTRICT"),
        nullable=True,
        unique=True,
        index=True,
    )
    same_day_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    same_day_preparation_confirmed: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    same_day_clinician_confirmed: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    same_day_escort_confirmed: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    same_day_confirmed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
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
    additional_slot: Mapped[ScheduleAdditionalSlot | None] = relationship()
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
