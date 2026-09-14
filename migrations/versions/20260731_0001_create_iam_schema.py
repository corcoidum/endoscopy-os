"""Sprint 1 IAM Schema 생성

Revision ID: 20260731_0001
Revises:
Create Date: 2026-07-31
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20260731_0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

IAM_SCHEMA = "iam"


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
    op.execute("CREATE SCHEMA IF NOT EXISTS iam")

    op.create_table(
        "staff_profiles",
        sa.Column("display_name", sa.String(length=100), nullable=False),
        sa.Column("staff_type", sa.String(length=30), nullable=False),
        sa.Column("employee_code", sa.String(length=40), nullable=True),
        sa.Column(
            "is_active",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
        sa.Column("deactivated_at", sa.DateTime(timezone=True), nullable=True),
        *_common_columns(),
        sa.CheckConstraint(
            "staff_type IN ('DOCTOR','NURSE','ASSISTANT','ADMINISTRATIVE','OTHER')",
            name="ck_staff_profiles_staff_type",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_staff_profiles"),
        sa.UniqueConstraint(
            "employee_code", name="uq_staff_profiles_employee_code"
        ),
        schema=IAM_SCHEMA,
    )
    op.create_index(
        "ix_staff_profiles_display_name",
        "staff_profiles",
        ["display_name"],
        schema=IAM_SCHEMA,
    )
    op.create_index(
        "ix_staff_profiles_is_active",
        "staff_profiles",
        ["is_active"],
        schema=IAM_SCHEMA,
    )
    op.create_index(
        "ix_staff_profiles_staff_type",
        "staff_profiles",
        ["staff_type"],
        schema=IAM_SCHEMA,
    )

    op.create_table(
        "roles",
        sa.Column("code", sa.String(length=40), nullable=False),
        sa.Column("name_ko", sa.String(length=80), nullable=False),
        sa.Column(
            "is_active",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
        *_common_columns(),
        sa.PrimaryKeyConstraint("id", name="pk_roles"),
        schema=IAM_SCHEMA,
    )
    op.create_index(
        "ix_roles_code",
        "roles",
        ["code"],
        unique=True,
        schema=IAM_SCHEMA,
    )
    op.create_index(
        "ix_roles_is_active",
        "roles",
        ["is_active"],
        schema=IAM_SCHEMA,
    )

    op.create_table(
        "permissions",
        sa.Column("code", sa.String(length=80), nullable=False),
        sa.Column("description_ko", sa.String(length=200), nullable=False),
        *_common_columns(),
        sa.PrimaryKeyConstraint("id", name="pk_permissions"),
        schema=IAM_SCHEMA,
    )
    op.create_index(
        "ix_permissions_code",
        "permissions",
        ["code"],
        unique=True,
        schema=IAM_SCHEMA,
    )

    op.create_table(
        "users",
        sa.Column("login_id_normalized", sa.String(length=80), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("display_name", sa.String(length=100), nullable=False),
        sa.Column("staff_profile_id", sa.Uuid(), nullable=True),
        sa.Column(
            "is_active",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
        sa.Column(
            "failed_login_count",
            sa.SmallInteger(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column("locked_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "password_changed_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "must_change_password",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "row_version",
            sa.Integer(),
            server_default=sa.text("1"),
            nullable=False,
        ),
        *_common_columns(),
        sa.CheckConstraint(
            "failed_login_count >= 0",
            name="ck_users_failed_login_nonnegative",
        ),
        sa.ForeignKeyConstraint(
            ["staff_profile_id"],
            [f"{IAM_SCHEMA}.staff_profiles.id"],
            name="fk_users_staff_profile_id_staff_profiles",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_users"),
        schema=IAM_SCHEMA,
    )
    op.create_index(
        "ix_users_display_name",
        "users",
        ["display_name"],
        schema=IAM_SCHEMA,
    )
    op.create_index(
        "ix_users_is_active",
        "users",
        ["is_active"],
        schema=IAM_SCHEMA,
    )
    op.create_index(
        "ix_users_locked_until",
        "users",
        ["locked_until"],
        schema=IAM_SCHEMA,
    )
    op.create_index(
        "ix_users_login_id_normalized",
        "users",
        ["login_id_normalized"],
        unique=True,
        schema=IAM_SCHEMA,
    )
    op.create_index(
        "ix_users_staff_profile_id",
        "users",
        ["staff_profile_id"],
        unique=True,
        schema=IAM_SCHEMA,
    )

    op.create_table(
        "role_permissions",
        sa.Column("role_id", sa.Uuid(), nullable=False),
        sa.Column("permission_id", sa.Uuid(), nullable=False),
        *_common_columns(),
        sa.ForeignKeyConstraint(
            ["permission_id"],
            [f"{IAM_SCHEMA}.permissions.id"],
            name="fk_role_permissions_permission_id_permissions",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["role_id"],
            [f"{IAM_SCHEMA}.roles.id"],
            name="fk_role_permissions_role_id_roles",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_role_permissions"),
        sa.UniqueConstraint(
            "role_id",
            "permission_id",
            name="uq_role_permissions_role_permission",
        ),
        schema=IAM_SCHEMA,
    )
    op.create_index(
        "ix_role_permissions_permission_id",
        "role_permissions",
        ["permission_id"],
        schema=IAM_SCHEMA,
    )
    op.create_index(
        "ix_role_permissions_role_id",
        "role_permissions",
        ["role_id"],
        schema=IAM_SCHEMA,
    )

    op.create_table(
        "user_roles",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("role_id", sa.Uuid(), nullable=False),
        sa.Column("valid_until", sa.DateTime(timezone=True), nullable=True),
        *_common_columns(),
        sa.ForeignKeyConstraint(
            ["role_id"],
            [f"{IAM_SCHEMA}.roles.id"],
            name="fk_user_roles_role_id_roles",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            [f"{IAM_SCHEMA}.users.id"],
            name="fk_user_roles_user_id_users",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_user_roles"),
        sa.UniqueConstraint(
            "user_id", "role_id", name="uq_user_roles_user_role"
        ),
        schema=IAM_SCHEMA,
    )
    op.create_index(
        "ix_user_roles_role_id",
        "user_roles",
        ["role_id"],
        schema=IAM_SCHEMA,
    )
    op.create_index(
        "ix_user_roles_user_id",
        "user_roles",
        ["user_id"],
        schema=IAM_SCHEMA,
    )
    op.create_index(
        "ix_user_roles_valid_until",
        "user_roles",
        ["valid_until"],
        schema=IAM_SCHEMA,
    )

    op.create_table(
        "user_sessions",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("session_token_hash", sa.String(length=64), nullable=False),
        sa.Column("csrf_secret_hash", sa.String(length=64), nullable=False),
        sa.Column("created_ip", postgresql.INET(), nullable=False),
        sa.Column("user_agent_summary", sa.String(length=200), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "last_seen_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "idle_expires_at", sa.DateTime(timezone=True), nullable=False
        ),
        sa.Column(
            "absolute_expires_at", sa.DateTime(timezone=True), nullable=False
        ),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoke_reason", sa.String(length=100), nullable=True),
        sa.Column(
            "id",
            sa.Uuid(),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            [f"{IAM_SCHEMA}.users.id"],
            name="fk_user_sessions_user_id_users",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_user_sessions"),
        schema=IAM_SCHEMA,
    )
    op.create_index(
        "ix_user_sessions_absolute_expires_at",
        "user_sessions",
        ["absolute_expires_at"],
        schema=IAM_SCHEMA,
    )
    op.create_index(
        "ix_user_sessions_created_ip",
        "user_sessions",
        ["created_ip"],
        schema=IAM_SCHEMA,
    )
    op.create_index(
        "ix_user_sessions_idle_expires_at",
        "user_sessions",
        ["idle_expires_at"],
        schema=IAM_SCHEMA,
    )
    op.create_index(
        "ix_user_sessions_last_seen_at",
        "user_sessions",
        ["last_seen_at"],
        schema=IAM_SCHEMA,
    )
    op.create_index(
        "ix_user_sessions_revoked_at",
        "user_sessions",
        ["revoked_at"],
        schema=IAM_SCHEMA,
    )
    op.create_index(
        "ix_user_sessions_session_token_hash",
        "user_sessions",
        ["session_token_hash"],
        unique=True,
        schema=IAM_SCHEMA,
    )
    op.create_index(
        "ix_user_sessions_user_id",
        "user_sessions",
        ["user_id"],
        schema=IAM_SCHEMA,
    )


def downgrade() -> None:
    op.drop_table("user_sessions", schema=IAM_SCHEMA)
    op.drop_table("user_roles", schema=IAM_SCHEMA)
    op.drop_table("role_permissions", schema=IAM_SCHEMA)
    op.drop_table("users", schema=IAM_SCHEMA)
    op.drop_table("permissions", schema=IAM_SCHEMA)
    op.drop_table("roles", schema=IAM_SCHEMA)
    op.drop_table("staff_profiles", schema=IAM_SCHEMA)
    op.execute("DROP SCHEMA IF EXISTS iam")
