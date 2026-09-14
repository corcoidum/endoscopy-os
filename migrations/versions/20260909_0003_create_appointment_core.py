"""Sprint 3A Appointment와 기본 Scheduling Core 생성

Revision ID: 20260909_0003
Revises: 20260731_0002
Create Date: 2026-09-09
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260909_0003"
down_revision: str | None = "20260731_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _uuid_column(name: str = "id") -> sa.Column:
    return sa.Column(
        name,
        sa.Uuid(),
        server_default=sa.text("gen_random_uuid()"),
        nullable=False,
    )


def _timestamp_columns() -> list[sa.Column]:
    return [
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    ]


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS btree_gist")

    op.create_table(
        "schedule_resources",
        _uuid_column(),
        sa.Column("code", sa.String(length=40), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column(
            "is_active",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
        *_timestamp_columns(),
        sa.PrimaryKeyConstraint("id", name="pk_schedule_resources"),
        sa.UniqueConstraint("code", name="uq_schedule_resources_code"),
    )
    op.create_index(
        "ix_schedule_resources_is_active",
        "schedule_resources",
        ["is_active"],
    )

    op.create_table(
        "appointments",
        _uuid_column(),
        sa.Column("patient_id", sa.Uuid(), nullable=False),
        sa.Column("resource_id", sa.Uuid(), nullable=False),
        sa.Column("service_date", sa.Date(), nullable=False),
        sa.Column(
            "scheduled_start_at",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.Column(
            "scheduled_end_at",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.Column(
            "booking_bucket",
            sa.String(length=30),
            server_default=sa.text("'STANDARD_MORNING'"),
            nullable=False,
        ),
        sa.Column("care_type", sa.String(length=20), nullable=False),
        sa.Column(
            "workflow_state",
            sa.String(length=30),
            server_default=sa.text("'BOOKED'"),
            nullable=False,
        ),
        sa.Column(
            "occupies_slot",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
        sa.Column(
            "schedule_policy_version", sa.String(length=80), nullable=False
        ),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=False),
        sa.Column("updated_by_user_id", sa.Uuid(), nullable=False),
        sa.Column(
            "row_version",
            sa.Integer(),
            server_default=sa.text("1"),
            nullable=False,
        ),
        *_timestamp_columns(),
        sa.CheckConstraint(
            "booking_bucket IN ('STANDARD_MORNING','AFTERNOON_EXCEPTION')",
            name="ck_appointments_booking_bucket",
        ),
        sa.CheckConstraint(
            "care_type IN ('GENERAL','SCREENING')",
            name="ck_appointments_care_type",
        ),
        sa.CheckConstraint(
            "workflow_state IN ('BOOKED','CANCELLED')",
            name="ck_appointments_workflow_state",
        ),
        sa.CheckConstraint(
            "scheduled_start_at < scheduled_end_at",
            name="ck_appointments_valid_interval",
        ),
        sa.ForeignKeyConstraint(
            ["patient_id"],
            ["patients.id"],
            name="fk_appointments_patient_id_patients",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["resource_id"],
            ["schedule_resources.id"],
            name="fk_appointments_resource_id_schedule_resources",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"],
            ["iam.users.id"],
            name="fk_appointments_created_by_user_id_users",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["updated_by_user_id"],
            ["iam.users.id"],
            name="fk_appointments_updated_by_user_id_users",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_appointments"),
    )
    for column in (
        "patient_id",
        "resource_id",
        "service_date",
        "scheduled_start_at",
        "scheduled_end_at",
        "workflow_state",
        "occupies_slot",
        "created_by_user_id",
        "updated_by_user_id",
    ):
        op.create_index(f"ix_appointments_{column}", "appointments", [column])
    op.create_index(
        "ix_appointments_service_date_state",
        "appointments",
        ["service_date", "workflow_state"],
    )
    op.execute(
        """
        ALTER TABLE appointments
        ADD CONSTRAINT ex_appointments_resource_time_no_overlap
        EXCLUDE USING gist (
            resource_id WITH =,
            tstzrange(scheduled_start_at, scheduled_end_at, '[)') WITH &&
        ) WHERE (occupies_slot)
        """
    )

    op.create_table(
        "appointment_procedures",
        _uuid_column(),
        sa.Column("appointment_id", sa.Uuid(), nullable=False),
        sa.Column("procedure_code", sa.String(length=20), nullable=False),
        sa.Column("sedation_mode", sa.String(length=20), nullable=False),
        sa.CheckConstraint(
            "procedure_code IN ('UPPER','COLON')",
            name="ck_appointment_procedures_procedure_code",
        ),
        sa.CheckConstraint(
            "sedation_mode IN ('SEDATED','NON_SEDATED')",
            name="ck_appointment_procedures_sedation_mode",
        ),
        sa.ForeignKeyConstraint(
            ["appointment_id"],
            ["appointments.id"],
            name="fk_appointment_procedures_appointment_id_appointments",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_appointment_procedures"),
        sa.UniqueConstraint(
            "appointment_id",
            "procedure_code",
            name="uq_appointment_procedures_appointment_code",
        ),
    )
    op.create_index(
        "ix_appointment_procedures_appointment_id",
        "appointment_procedures",
        ["appointment_id"],
    )
    op.create_index(
        "ix_appointment_procedures_procedure_code",
        "appointment_procedures",
        ["procedure_code"],
    )

    op.create_table(
        "appointment_history_events",
        _uuid_column(),
        sa.Column("appointment_id", sa.Uuid(), nullable=False),
        sa.Column("event_type", sa.String(length=20), nullable=False),
        sa.Column("changed_fields", sa.JSON(), nullable=False),
        sa.Column("before_values", sa.JSON(), nullable=True),
        sa.Column("after_values", sa.JSON(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("actor_user_id", sa.Uuid(), nullable=False),
        sa.Column(
            "occurred_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "event_type IN ('CREATED','UPDATED','CANCELLED')",
            name="ck_appointment_history_events_event_type",
        ),
        sa.ForeignKeyConstraint(
            ["appointment_id"],
            ["appointments.id"],
            name="fk_appointment_history_events_appointment_id_appointments",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["actor_user_id"],
            ["iam.users.id"],
            name="fk_appointment_history_events_actor_user_id_users",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_appointment_history_events"),
    )
    op.create_index(
        "ix_appointment_history_events_appointment_id",
        "appointment_history_events",
        ["appointment_id"],
    )
    op.create_index(
        "ix_appointment_history_events_actor_user_id",
        "appointment_history_events",
        ["actor_user_id"],
    )
    op.create_index(
        "ix_appointment_history_events_occurred_at",
        "appointment_history_events",
        ["occurred_at"],
    )
    op.create_index(
        "ix_appointment_history_appointment_occurred",
        "appointment_history_events",
        ["appointment_id", "occurred_at"],
    )


def downgrade() -> None:
    op.drop_table("appointment_history_events")
    op.drop_table("appointment_procedures")
    op.drop_table("appointments")
    op.drop_table("schedule_resources")
