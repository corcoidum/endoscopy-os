"""당일 위내시경과 승인된 30분 연장 슬롯

Revision ID: 20260918_0006
Revises: 20260916_0005
Create Date: 2026-09-18

Downgrade 전에 SAME_DAY 예약과 연장 슬롯 예약을 제거하거나 사전 예약으로
정정해야 한다. 운영 Database에서는 Backup 후에만 실행한다.
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260918_0006"
down_revision: str | None = "20260916_0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


LEGACY_BOOKING_BUCKET_CHECK = "ck_appointments_ck_appointments_booking_bucket"


def _user_fk(table: str, column: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        [column],
        ["iam.users.id"],
        name=f"fk_{table}_{column}_users",
        ondelete="RESTRICT",
    )


def upgrade() -> None:
    op.create_table(
        "schedule_additional_slots",
        sa.Column(
            "id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False
        ),
        sa.Column("resource_id", sa.Uuid(), nullable=False),
        sa.Column("service_date", sa.Date(), nullable=False),
        sa.Column("start_time", sa.Time(), nullable=False),
        sa.Column("end_time", sa.Time(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column(
            "status",
            sa.String(length=20),
            server_default=sa.text("'APPROVED'"),
            nullable=False,
        ),
        sa.Column("approved_by_user_id", sa.Uuid(), nullable=False),
        sa.Column("approved_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("revoked_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoke_reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("status IN ('APPROVED','REVOKED')", name="status"),
        sa.CheckConstraint("start_time < end_time", name="valid_interval"),
        sa.CheckConstraint(
            "status <> 'REVOKED' OR "
            "(revoked_by_user_id IS NOT NULL AND revoked_at IS NOT NULL "
            "AND revoke_reason IS NOT NULL)",
            name="revocation_metadata",
        ),
        sa.ForeignKeyConstraint(
            ["resource_id"],
            ["schedule_resources.id"],
            name="fk_schedule_additional_slots_resource_id_schedule_resources",
            ondelete="RESTRICT",
        ),
        _user_fk("schedule_additional_slots", "approved_by_user_id"),
        _user_fk("schedule_additional_slots", "revoked_by_user_id"),
        sa.PrimaryKeyConstraint("id", name="pk_schedule_additional_slots"),
        sa.UniqueConstraint(
            "resource_id",
            "service_date",
            "start_time",
            name="uq_schedule_additional_slots_resource_date_start",
        ),
    )
    for column in (
        "resource_id",
        "service_date",
        "status",
        "approved_by_user_id",
        "revoked_by_user_id",
    ):
        op.create_index(
            f"ix_schedule_additional_slots_{column}",
            "schedule_additional_slots",
            [column],
        )

    op.add_column(
        "appointments",
        sa.Column(
            "booking_origin",
            sa.String(length=20),
            server_default=sa.text("'ADVANCE'"),
            nullable=False,
        ),
    )
    op.add_column("appointments", sa.Column("additional_slot_id", sa.Uuid(), nullable=True))
    op.add_column("appointments", sa.Column("same_day_reason", sa.Text(), nullable=True))
    for column in (
        "same_day_preparation_confirmed",
        "same_day_clinician_confirmed",
        "same_day_escort_confirmed",
    ):
        op.add_column(
            "appointments",
            sa.Column(column, sa.Boolean(), server_default=sa.text("false"), nullable=False),
        )
    op.add_column(
        "appointments",
        sa.Column("same_day_confirmed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_appointments_additional_slot_id_schedule_additional_slots",
        "appointments",
        "schedule_additional_slots",
        ["additional_slot_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index(
        "ix_appointments_additional_slot_id", "appointments", ["additional_slot_id"], unique=True
    )

    op.drop_constraint(op.f(LEGACY_BOOKING_BUCKET_CHECK), "appointments", type_="check")
    op.create_check_constraint(
        "booking_bucket",
        "appointments",
        "booking_bucket IN "
        "('STANDARD_MORNING','AFTERNOON_EXCEPTION','SAME_DAY_EXTENSION')",
    )
    op.create_check_constraint(
        "booking_origin",
        "appointments",
        "booking_origin IN ('ADVANCE','SAME_DAY')",
    )
    op.create_check_constraint(
        "additional_slot_matches_bucket",
        "appointments",
        "(booking_bucket = 'SAME_DAY_EXTENSION' AND additional_slot_id IS NOT NULL) "
        "OR (booking_bucket <> 'SAME_DAY_EXTENSION' AND additional_slot_id IS NULL)",
    )
    op.create_check_constraint(
        "same_day_confirmation_metadata",
        "appointments",
        "booking_origin <> 'SAME_DAY' OR "
        "(same_day_reason IS NOT NULL AND same_day_preparation_confirmed = true "
        "AND same_day_clinician_confirmed = true "
        "AND same_day_confirmed_at IS NOT NULL)",
    )


def downgrade() -> None:
    for name in (
        "same_day_confirmation_metadata",
        "additional_slot_matches_bucket",
        "booking_origin",
        "booking_bucket",
    ):
        op.drop_constraint(name, "appointments", type_="check")
    op.create_check_constraint(
        op.f(LEGACY_BOOKING_BUCKET_CHECK),
        "appointments",
        "booking_bucket IN ('STANDARD_MORNING','AFTERNOON_EXCEPTION')",
    )
    op.drop_index("ix_appointments_additional_slot_id", table_name="appointments")
    op.drop_constraint(
        "fk_appointments_additional_slot_id_schedule_additional_slots",
        "appointments",
        type_="foreignkey",
    )
    for column in (
        "same_day_confirmed_at",
        "same_day_escort_confirmed",
        "same_day_clinician_confirmed",
        "same_day_preparation_confirmed",
        "same_day_reason",
        "additional_slot_id",
        "booking_origin",
    ):
        op.drop_column("appointments", column)
    op.drop_table("schedule_additional_slots")
