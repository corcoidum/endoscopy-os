"""Sprint 2 Patient와 변경 History 생성

Revision ID: 20260731_0002
Revises: 20260731_0001
Create Date: 2026-07-31
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260731_0002"
down_revision: str | None = "20260731_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _common_columns() -> list[sa.Column]:
    return [
        sa.Column(
            "id",
            sa.Uuid(),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
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
    # 연락처와 특이사항은 Database에 평문으로 넣지 않는다.
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")

    op.create_table(
        "patients",
        sa.Column("chart_number", sa.String(length=40), nullable=False),
        sa.Column(
            "chart_number_normalized", sa.String(length=40), nullable=False
        ),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("birth_date", sa.Date(), nullable=False),
        sa.Column("sex", sa.String(length=10), nullable=False),
        sa.Column("phone_ciphertext", sa.LargeBinary(), nullable=True),
        sa.Column(
            "special_notes_ciphertext", sa.LargeBinary(), nullable=True
        ),
        sa.Column(
            "cancellation_count_cache",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column(
            "no_show_count_cache",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column(
            "is_active",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
        sa.Column(
            "deactivated_at", sa.DateTime(timezone=True), nullable=True
        ),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=False),
        sa.Column("updated_by_user_id", sa.Uuid(), nullable=False),
        sa.Column(
            "row_version",
            sa.Integer(),
            server_default=sa.text("1"),
            nullable=False,
        ),
        *_common_columns(),
        sa.CheckConstraint(
            "sex IN ('MALE','FEMALE')",
            name="ck_patients_sex",
        ),
        sa.CheckConstraint(
            "cancellation_count_cache >= 0",
            name="ck_patients_cancellation_count_nonnegative",
        ),
        sa.CheckConstraint(
            "no_show_count_cache >= 0",
            name="ck_patients_no_show_count_nonnegative",
        ),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"],
            ["iam.users.id"],
            name="fk_patients_created_by_user_id_users",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["updated_by_user_id"],
            ["iam.users.id"],
            name="fk_patients_updated_by_user_id_users",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_patients"),
        sa.UniqueConstraint(
            "chart_number_normalized",
            name="uq_patients_chart_number_normalized",
        ),
    )
    op.create_index(
        "ix_patients_birth_date", "patients", ["birth_date"]
    )
    op.create_index(
        "ix_patients_cancellation_count_cache",
        "patients",
        ["cancellation_count_cache"],
    )
    op.create_index(
        "ix_patients_created_by_user_id",
        "patients",
        ["created_by_user_id"],
    )
    op.create_index(
        "ix_patients_deactivated_at", "patients", ["deactivated_at"]
    )
    op.create_index(
        "ix_patients_demographics",
        "patients",
        ["name", "birth_date", "sex"],
    )
    op.create_index("ix_patients_is_active", "patients", ["is_active"])
    op.create_index("ix_patients_name", "patients", ["name"])
    op.create_index(
        "ix_patients_no_show_count_cache",
        "patients",
        ["no_show_count_cache"],
    )
    op.create_index("ix_patients_sex", "patients", ["sex"])
    op.create_index(
        "ix_patients_updated_by_user_id",
        "patients",
        ["updated_by_user_id"],
    )

    op.create_table(
        "patient_history_events",
        sa.Column("patient_id", sa.Uuid(), nullable=False),
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
        sa.Column(
            "id",
            sa.Uuid(),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "event_type IN ('CREATED','UPDATED','DEACTIVATED','REACTIVATED')",
            name="ck_patient_history_events_event_type",
        ),
        sa.ForeignKeyConstraint(
            ["actor_user_id"],
            ["iam.users.id"],
            name="fk_patient_history_events_actor_user_id_users",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["patient_id"],
            ["patients.id"],
            name="fk_patient_history_events_patient_id_patients",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_patient_history_events"),
    )
    op.create_index(
        "ix_patient_history_events_actor_user_id",
        "patient_history_events",
        ["actor_user_id"],
    )
    op.create_index(
        "ix_patient_history_events_event_type",
        "patient_history_events",
        ["event_type"],
    )
    op.create_index(
        "ix_patient_history_events_occurred_at",
        "patient_history_events",
        ["occurred_at"],
    )
    op.create_index(
        "ix_patient_history_events_patient_id",
        "patient_history_events",
        ["patient_id"],
    )
    op.create_index(
        "ix_patient_history_patient_occurred",
        "patient_history_events",
        ["patient_id", "occurred_at"],
    )


def downgrade() -> None:
    # pgcrypto는 다른 데이터에서도 사용할 수 있으므로 Extension 자체는 제거하지 않는다.
    op.drop_table("patient_history_events")
    op.drop_table("patients")
