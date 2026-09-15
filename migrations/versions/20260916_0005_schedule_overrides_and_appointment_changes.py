"""Sprint 3B 날짜별 일정 예외와 예약 변경·취소·No-show·오후 예외 확인

Revision ID: 20260916_0005
Revises: 20260915_0004
Create Date: 2026-09-16

주의: Downgrade는 `NO_SHOW` 상태와 새 History Event 종류를 표현할 수 없으므로
해당 행이 있으면 실패한다. 운영 Database에서는 Backup 후에만 실행한다.
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260916_0005"
down_revision: str | None = "20260915_0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# 이전 Migration은 Naming Convention이 이름에 한 번 더 붙은 상태로 생성되었다.
LEGACY_WORKFLOW_STATE_CHECK = "ck_appointments_ck_appointments_workflow_state"
LEGACY_HISTORY_EVENT_TYPE_CHECK = (
    "ck_appointment_history_events_ck_appointment_history_ev_1b0a"
)

OVERRIDE_INDEX_COLUMNS = (
    "resource_id",
    "service_date",
    "status",
    "requested_by_user_id",
    "approved_by_user_id",
    "revoked_by_user_id",
    "superseded_by_id",
)


def _user_fk(table: str, column: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        [column],
        ["iam.users.id"],
        name=f"fk_{table}_{column}_users",
        ondelete="RESTRICT",
    )


def upgrade() -> None:
    op.create_table(
        "schedule_date_overrides",
        sa.Column(
            "id",
            sa.Uuid(),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("resource_id", sa.Uuid(), nullable=False),
        sa.Column("service_date", sa.Date(), nullable=False),
        sa.Column("rule_type", sa.String(length=30), nullable=False),
        sa.Column("override_start_time", sa.Time(), nullable=True),
        sa.Column("override_end_time", sa.Time(), nullable=True),
        sa.Column("override_upper_capacity", sa.SmallInteger(), nullable=True),
        sa.Column("override_colon_capacity", sa.SmallInteger(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column(
            "status",
            sa.String(length=20),
            server_default=sa.text("'PENDING'"),
            nullable=False,
        ),
        sa.Column("requested_by_user_id", sa.Uuid(), nullable=False),
        sa.Column("approved_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoke_reason", sa.Text(), nullable=True),
        sa.Column("superseded_by_id", sa.Uuid(), nullable=True),
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
        sa.CheckConstraint(
            "rule_type IN "
            "('CLOSED','OPERATING_HOURS','CAPACITY','AFTERNOON_ALLOW')",
            name="rule_type",
        ),
        sa.CheckConstraint(
            "status IN ('PENDING','APPROVED','REVOKED','SUPERSEDED')",
            name="status",
        ),
        sa.CheckConstraint(
            "rule_type <> 'OPERATING_HOURS' OR "
            "(override_start_time IS NOT NULL AND override_end_time IS NOT NULL "
            "AND override_start_time < override_end_time)",
            name="operating_hours_values",
        ),
        sa.CheckConstraint(
            "rule_type <> 'CAPACITY' OR "
            "override_upper_capacity IS NOT NULL OR "
            "override_colon_capacity IS NOT NULL",
            name="capacity_values",
        ),
        sa.CheckConstraint(
            "(override_upper_capacity IS NULL OR override_upper_capacity >= 0) "
            "AND (override_colon_capacity IS NULL OR override_colon_capacity >= 0)",
            name="capacity_non_negative",
        ),
        sa.CheckConstraint(
            "status <> 'APPROVED' OR "
            "(approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL)",
            name="approval_metadata",
        ),
        sa.ForeignKeyConstraint(
            ["resource_id"],
            ["schedule_resources.id"],
            name="fk_schedule_date_overrides_resource_id_schedule_resources",
            ondelete="RESTRICT",
        ),
        _user_fk("schedule_date_overrides", "requested_by_user_id"),
        _user_fk("schedule_date_overrides", "approved_by_user_id"),
        _user_fk("schedule_date_overrides", "revoked_by_user_id"),
        sa.ForeignKeyConstraint(
            ["superseded_by_id"],
            ["schedule_date_overrides.id"],
            name="fk_schedule_date_overrides_superseded_by_id",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_schedule_date_overrides"),
    )
    for column in OVERRIDE_INDEX_COLUMNS:
        op.create_index(
            f"ix_schedule_date_overrides_{column}",
            "schedule_date_overrides",
            [column],
        )
    op.create_index(
        "uq_schedule_date_overrides_approved_rule",
        "schedule_date_overrides",
        ["resource_id", "service_date", "rule_type"],
        unique=True,
        postgresql_where=sa.text("status = 'APPROVED'"),
    )

    op.add_column(
        "appointments", sa.Column("exception_reason", sa.Text(), nullable=True)
    )
    op.add_column(
        "appointments", sa.Column("exception_memo", sa.Text(), nullable=True)
    )
    for column in (
        "exception_registered_by_user_id",
        "exception_confirmed_by_user_id",
    ):
        op.add_column("appointments", sa.Column(column, sa.Uuid(), nullable=True))
        op.create_foreign_key(
            f"fk_appointments_{column}_users",
            "appointments",
            "users",
            [column],
            ["id"],
            referent_schema="iam",
            ondelete="RESTRICT",
        )
        op.create_index(f"ix_appointments_{column}", "appointments", [column])
    op.add_column(
        "appointments",
        sa.Column("exception_confirmed_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.drop_constraint(
        op.f(LEGACY_WORKFLOW_STATE_CHECK), "appointments", type_="check"
    )
    op.create_check_constraint(
        "workflow_state",
        "appointments",
        "workflow_state IN ('BOOKED','CANCELLED','NO_SHOW')",
    )
    op.create_check_constraint(
        "occupancy_matches_state",
        "appointments",
        "occupies_slot = (workflow_state = 'BOOKED')",
    )
    op.create_check_constraint(
        "afternoon_exception_metadata",
        "appointments",
        "booking_bucket <> 'AFTERNOON_EXCEPTION' OR "
        "(exception_reason IS NOT NULL AND "
        "exception_registered_by_user_id IS NOT NULL)",
    )
    op.create_check_constraint(
        "exception_confirmer_differs",
        "appointments",
        "exception_confirmed_by_user_id IS NULL OR "
        "(exception_confirmed_by_user_id <> exception_registered_by_user_id "
        "AND exception_confirmed_at IS NOT NULL)",
    )

    op.drop_constraint(
        op.f(LEGACY_HISTORY_EVENT_TYPE_CHECK),
        "appointment_history_events",
        type_="check",
    )
    op.create_check_constraint(
        "event_type",
        "appointment_history_events",
        "event_type IN "
        "('CREATED','UPDATED','CANCELLED','NO_SHOW','EXCEPTION_CONFIRMED')",
    )


def downgrade() -> None:
    op.drop_constraint(
        "event_type", "appointment_history_events", type_="check"
    )
    op.create_check_constraint(
        op.f(LEGACY_HISTORY_EVENT_TYPE_CHECK),
        "appointment_history_events",
        "event_type IN ('CREATED','UPDATED','CANCELLED')",
    )

    for name in (
        "exception_confirmer_differs",
        "afternoon_exception_metadata",
        "occupancy_matches_state",
        "workflow_state",
    ):
        op.drop_constraint(name, "appointments", type_="check")
    op.create_check_constraint(
        op.f(LEGACY_WORKFLOW_STATE_CHECK),
        "appointments",
        "workflow_state IN ('BOOKED','CANCELLED')",
    )

    op.drop_column("appointments", "exception_confirmed_at")
    for column in (
        "exception_confirmed_by_user_id",
        "exception_registered_by_user_id",
    ):
        op.drop_index(f"ix_appointments_{column}", table_name="appointments")
        op.drop_constraint(
            f"fk_appointments_{column}_users", "appointments", type_="foreignkey"
        )
        op.drop_column("appointments", column)
    op.drop_column("appointments", "exception_memo")
    op.drop_column("appointments", "exception_reason")

    op.drop_table("schedule_date_overrides")
