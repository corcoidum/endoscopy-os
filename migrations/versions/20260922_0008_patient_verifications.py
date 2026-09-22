"""예약별 인적사항 1·2차 확인과 1차 확인 권한

Revision ID: 20260922_0008
Revises: 20260918_0007
Create Date: 2026-09-22

- `patient_verifications`: 확인 당시 Snapshot과 무효화·정정 이력을 지우지 않고
  남긴다. 단계별 유효 확인은 예약마다 하나만 허용한다(부분 Unique Index).
- `verification.primary` 권한을 만들고, 이미 존재하는 관리자·원무 Role에 부여한다.

Downgrade는 확인 기록 전체를 지우므로 운영 Database에서는 Backup 후에만 실행한다.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260922_0008"
down_revision: str | None = "20260918_0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLE = "patient_verifications"
PRIMARY_PERMISSION = "verification.primary"
PRIMARY_ROLES = ("ADMIN", "FRONT_DESK")


def _user_fk(column: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        [column],
        ["iam.users.id"],
        name=f"fk_{TABLE}_{column}_users",
        ondelete="RESTRICT",
    )


def upgrade() -> None:
    op.create_table(
        TABLE,
        sa.Column(
            "id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False
        ),
        sa.Column("appointment_id", sa.Uuid(), nullable=False),
        sa.Column("stage", sa.String(length=20), nullable=False),
        sa.Column(
            "is_valid", sa.Boolean(), server_default=sa.text("true"), nullable=False
        ),
        sa.Column("snapshot", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("snapshot_hash", sa.String(length=64), nullable=False),
        sa.Column("computed_age", sa.SmallInteger(), nullable=False),
        sa.Column("age_method", sa.String(length=30), nullable=False),
        sa.Column("age_reference_date", sa.Date(), nullable=False),
        sa.Column("appointment_row_version", sa.Integer(), nullable=False),
        sa.Column("method", sa.String(length=30), nullable=False),
        sa.Column("memo", sa.Text(), nullable=True),
        sa.Column("verified_by_user_id", sa.Uuid(), nullable=False),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("invalidated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("invalidated_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("invalidation_type", sa.String(length=30), nullable=True),
        sa.Column("invalidation_reason", sa.Text(), nullable=True),
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
        sa.CheckConstraint("stage IN ('PRIMARY','SECONDARY')", name="stage"),
        sa.CheckConstraint(
            "method IN ('IN_PERSON','ID_DOCUMENT','PHONE','CHART_RECORD')",
            name="method",
        ),
        sa.CheckConstraint(
            "age_method IN ('SCREENING_YEAR_AGE','FULL_AGE')", name="age_method"
        ),
        sa.CheckConstraint("computed_age >= 0", name="computed_age_non_negative"),
        sa.CheckConstraint(
            "invalidation_type IS NULL OR "
            "invalidation_type IN ('CORE_CHANGED','CORRECTED')",
            name="invalidation_type",
        ),
        sa.CheckConstraint(
            "is_valid OR (invalidated_at IS NOT NULL "
            "AND invalidation_type IS NOT NULL "
            "AND invalidation_reason IS NOT NULL)",
            name="invalidation_metadata",
        ),
        sa.CheckConstraint(
            "NOT is_valid OR (invalidated_at IS NULL AND invalidation_type IS NULL)",
            name="valid_without_invalidation",
        ),
        sa.ForeignKeyConstraint(
            ["appointment_id"],
            ["appointments.id"],
            name=f"fk_{TABLE}_appointment_id_appointments",
            ondelete="RESTRICT",
        ),
        _user_fk("verified_by_user_id"),
        _user_fk("invalidated_by_user_id"),
        sa.PrimaryKeyConstraint("id", name=f"pk_{TABLE}"),
    )
    for column in (
        "appointment_id",
        "is_valid",
        "snapshot_hash",
        "verified_by_user_id",
        "invalidated_by_user_id",
    ):
        op.create_index(f"ix_{TABLE}_{column}", TABLE, [column])
    op.create_index(
        "uq_patient_verifications_valid_stage",
        TABLE,
        ["appointment_id", "stage"],
        unique=True,
        postgresql_where=sa.text("is_valid"),
    )

    # 이미 Seed된 Database에도 1차 확인 권한을 반영한다. 다시 실행해도 중복되지 않는다.
    bind = op.get_bind()
    bind.execute(
        sa.text(
            # 같은 Parameter를 두 곳에 쓰므로 PostgreSQL이 Type을 일관되게 추론하도록 고정한다.
            "INSERT INTO iam.permissions (code, description_ko) "
            "SELECT CAST(:code AS VARCHAR(80)), CAST(:description AS VARCHAR(200)) "
            "WHERE NOT EXISTS (SELECT 1 FROM iam.permissions "
            "WHERE code = CAST(:code AS VARCHAR(80)))"
        ),
        {"code": PRIMARY_PERMISSION, "description": "인적사항 1차 확인"},
    )
    bind.execute(
        sa.text(
            "INSERT INTO iam.role_permissions (role_id, permission_id) "
            "SELECT r.id, p.id FROM iam.roles r CROSS JOIN iam.permissions p "
            "WHERE r.code IN :roles AND p.code = :code "
            "AND NOT EXISTS (SELECT 1 FROM iam.role_permissions rp "
            "WHERE rp.role_id = r.id AND rp.permission_id = p.id)"
        ).bindparams(sa.bindparam("roles", expanding=True)),
        {"roles": list(PRIMARY_ROLES), "code": PRIMARY_PERMISSION},
    )


def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(
        sa.text(
            "DELETE FROM iam.role_permissions WHERE permission_id IN "
            "(SELECT id FROM iam.permissions WHERE code = :code)"
        ),
        {"code": PRIMARY_PERMISSION},
    )
    bind.execute(
        sa.text("DELETE FROM iam.permissions WHERE code = :code"),
        {"code": PRIMARY_PERMISSION},
    )
    op.drop_index("uq_patient_verifications_valid_stage", table_name=TABLE)
    for column in (
        "invalidated_by_user_id",
        "verified_by_user_id",
        "snapshot_hash",
        "is_valid",
        "appointment_id",
    ):
        op.drop_index(f"ix_{TABLE}_{column}", table_name=TABLE)
    op.drop_table(TABLE)
