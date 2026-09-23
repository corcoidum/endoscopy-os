"""대장내시경 복용약 확인과 약별 의사 결정 기록

Revision ID: 20260923_0009
Revises: 20260922_0008
Create Date: 2026-09-23

- `medication_reviews`: 예약별 복용약 확인 Checklist(목록·없음 확인, 복용 분류,
  수술·심혈관 시술력, EMR 기록). 약 목록·수술력은 `pgcrypto`로 암호화한다.
- `medication_review_revisions`: Checklist를 저장할 때마다 전체 값을 암호화한
  Snapshot으로 쌓는다.
- `medication_items`: 중단 검토 약별 의사 결정 Revision. 약마다 유효한 Revision은
  하나뿐이다(부분 Unique Index). 이전 결정은 지우지 않는다.
- `medication.read`·`medication.write`·`medication.decision` 권한을 만들고 기존
  관리자·원무·내시경 담당 Role에 부여한다.

Downgrade는 복용약 기록 전체를 지우므로 운영 Database에서는 Backup 후에만 실행한다.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260923_0009"
down_revision: str | None = "20260922_0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

REVIEWS = "medication_reviews"
REVISIONS = "medication_review_revisions"
ITEMS = "medication_items"
CATEGORY_COLUMNS = (
    "anticoagulant_present",
    "antiplatelet_present",
    "circulation_drug_present",
    "cardiac_drug_present",
    "neurologic_drug_present",
    "chronic_disease_drug_present",
)
PERMISSIONS = {
    "medication.read": "복용약·의사 결정 조회",
    "medication.write": "복용약 확인·환자 안내 기록",
    "medication.decision": "의사의 약 중단·지속 결정 기록",
}
GRANTED_ROLES = ("ADMIN", "FRONT_DESK", "ENDOSCOPY_STAFF")


def _timestamps() -> list[sa.Column]:
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


def _id() -> sa.Column:
    return sa.Column(
        "id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False
    )


def _user_fk(table: str, column: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        [column], ["iam.users.id"], name=f"fk_{table}_{column}_users", ondelete="RESTRICT"
    )


def _flag(name: str) -> sa.Column:
    return sa.Column(name, sa.Boolean(), server_default=sa.text("false"), nullable=False)


def upgrade() -> None:
    op.create_table(
        REVIEWS,
        _id(),
        sa.Column("appointment_id", sa.Uuid(), nullable=False),
        sa.Column(
            "medication_status",
            sa.String(length=20),
            server_default="UNCHECKED",
            nullable=False,
        ),
        sa.Column("medication_list_ciphertext", sa.LargeBinary(), nullable=True),
        *[_flag(name) for name in CATEGORY_COLUMNS],
        sa.Column("surgery_history_ciphertext", sa.LargeBinary(), nullable=True),
        sa.Column("cardiovascular_history_ciphertext", sa.LargeBinary(), nullable=True),
        _flag("emr_recorded"),
        sa.Column("confirmed_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by_user_id", sa.Uuid(), nullable=False),
        sa.Column("row_version", sa.Integer(), server_default=sa.text("1"), nullable=False),
        *_timestamps(),
        sa.CheckConstraint(
            "medication_status IN ('UNCHECKED','LIST_CONFIRMED','NONE_CONFIRMED')",
            name="medication_status",
        ),
        sa.CheckConstraint(
            "medication_status <> 'LIST_CONFIRMED' "
            "OR medication_list_ciphertext IS NOT NULL",
            name="medication_list_required",
        ),
        sa.CheckConstraint(
            "medication_status <> 'NONE_CONFIRMED' OR NOT ("
            + " OR ".join(CATEGORY_COLUMNS)
            + ")",
            name="none_without_categories",
        ),
        sa.CheckConstraint(
            "(confirmed_by_user_id IS NULL) = (confirmed_at IS NULL)",
            name="confirmation_pair",
        ),
        sa.CheckConstraint(
            "(medication_status = 'UNCHECKED') = (confirmed_at IS NULL)",
            name="confirmed_status",
        ),
        sa.CheckConstraint("row_version >= 1", name="row_version_positive"),
        sa.ForeignKeyConstraint(
            ["appointment_id"],
            ["appointments.id"],
            name=f"fk_{REVIEWS}_appointment_id_appointments",
            ondelete="RESTRICT",
        ),
        _user_fk(REVIEWS, "confirmed_by_user_id"),
        _user_fk(REVIEWS, "updated_by_user_id"),
        sa.PrimaryKeyConstraint("id", name=f"pk_{REVIEWS}"),
    )
    op.create_index(
        f"ix_{REVIEWS}_appointment_id", REVIEWS, ["appointment_id"], unique=True
    )
    for column in ("confirmed_by_user_id", "updated_by_user_id"):
        op.create_index(f"ix_{REVIEWS}_{column}", REVIEWS, [column])

    op.create_table(
        REVISIONS,
        _id(),
        sa.Column("review_id", sa.Uuid(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("medication_status", sa.String(length=20), nullable=False),
        sa.Column("snapshot_ciphertext", sa.LargeBinary(), nullable=False),
        sa.Column("saved_by_user_id", sa.Uuid(), nullable=False),
        sa.Column("saved_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("revision >= 1", name="revision_positive"),
        sa.ForeignKeyConstraint(
            ["review_id"],
            [f"{REVIEWS}.id"],
            name=f"fk_{REVISIONS}_review_id_{REVIEWS}",
            ondelete="RESTRICT",
        ),
        _user_fk(REVISIONS, "saved_by_user_id"),
        sa.PrimaryKeyConstraint("id", name=f"pk_{REVISIONS}"),
        sa.UniqueConstraint("review_id", "revision", name=f"uq_{REVISIONS}_review_id"),
    )
    for column in ("review_id", "saved_by_user_id"):
        op.create_index(f"ix_{REVISIONS}_{column}", REVISIONS, [column])

    op.create_table(
        ITEMS,
        _id(),
        sa.Column("review_id", sa.Uuid(), nullable=False),
        sa.Column("item_key", sa.Uuid(), nullable=False),
        sa.Column("revision", sa.SmallInteger(), nullable=False),
        sa.Column(
            "status", sa.String(length=20), server_default="ACTIVE", nullable=False
        ),
        sa.Column("medication_name_ciphertext", sa.LargeBinary(), nullable=False),
        sa.Column("decision", sa.String(length=20), nullable=False),
        sa.Column("hold_days", sa.SmallInteger(), nullable=True),
        sa.Column("rationale_ciphertext", sa.LargeBinary(), nullable=True),
        sa.Column("physician_profile_id", sa.Uuid(), nullable=True),
        sa.Column("decided_for_service_date", sa.Date(), nullable=True),
        sa.Column("recorded_by_user_id", sa.Uuid(), nullable=False),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("patient_notified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("patient_notified_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("hold_confirmed_on", sa.Date(), nullable=True),
        sa.Column("hold_confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("hold_confirmed_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ended_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("end_reason", sa.Text(), nullable=True),
        *_timestamps(),
        sa.CheckConstraint(
            "status IN ('ACTIVE','SUPERSEDED','WITHDRAWN')", name="status"
        ),
        sa.CheckConstraint("decision IN ('PENDING','HOLD','CONTINUE')", name="decision"),
        sa.CheckConstraint("revision >= 1", name="revision_positive"),
        sa.CheckConstraint(
            "decision <> 'HOLD' OR hold_days BETWEEN 1 AND 90", name="hold_days_range"
        ),
        sa.CheckConstraint(
            "decision = 'HOLD' OR hold_days IS NULL", name="hold_days_only_for_hold"
        ),
        sa.CheckConstraint(
            "decision <> 'CONTINUE' OR rationale_ciphertext IS NOT NULL",
            name="continue_rationale",
        ),
        sa.CheckConstraint(
            "(decision = 'PENDING') = (physician_profile_id IS NULL)",
            name="physician_for_decision",
        ),
        sa.CheckConstraint(
            "(decision = 'PENDING') = (decided_for_service_date IS NULL)",
            name="service_date_for_decision",
        ),
        sa.CheckConstraint(
            "(patient_notified_at IS NULL) = (patient_notified_by_user_id IS NULL)",
            name="notification_pair",
        ),
        sa.CheckConstraint(
            "decision <> 'PENDING' OR patient_notified_at IS NULL",
            name="notify_after_decision",
        ),
        sa.CheckConstraint(
            "(hold_confirmed_on IS NULL) = (hold_confirmed_by_user_id IS NULL) "
            "AND (hold_confirmed_on IS NULL) = (hold_confirmed_at IS NULL)",
            name="hold_confirmation_triple",
        ),
        sa.CheckConstraint(
            "decision = 'HOLD' OR hold_confirmed_on IS NULL",
            name="hold_confirmation_only_for_hold",
        ),
        sa.CheckConstraint(
            "(status = 'ACTIVE') = (ended_at IS NULL)", name="ended_when_inactive"
        ),
        sa.CheckConstraint(
            "(ended_at IS NULL) = (ended_by_user_id IS NULL)", name="ended_pair"
        ),
        sa.CheckConstraint(
            "status <> 'WITHDRAWN' OR end_reason IS NOT NULL", name="withdraw_reason"
        ),
        sa.ForeignKeyConstraint(
            ["review_id"],
            [f"{REVIEWS}.id"],
            name=f"fk_{ITEMS}_review_id_{REVIEWS}",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["physician_profile_id"],
            ["iam.staff_profiles.id"],
            name=f"fk_{ITEMS}_physician_profile_id_staff_profiles",
            ondelete="RESTRICT",
        ),
        _user_fk(ITEMS, "recorded_by_user_id"),
        _user_fk(ITEMS, "patient_notified_by_user_id"),
        _user_fk(ITEMS, "hold_confirmed_by_user_id"),
        _user_fk(ITEMS, "ended_by_user_id"),
        sa.PrimaryKeyConstraint("id", name=f"pk_{ITEMS}"),
        sa.UniqueConstraint("item_key", "revision", name=f"uq_{ITEMS}_item_key"),
    )
    for column in (
        "review_id",
        "item_key",
        "status",
        "physician_profile_id",
        "recorded_by_user_id",
        "patient_notified_by_user_id",
        "hold_confirmed_by_user_id",
        "ended_by_user_id",
    ):
        op.create_index(f"ix_{ITEMS}_{column}", ITEMS, [column])
    op.create_index(
        "uq_medication_items_active_item",
        ITEMS,
        ["item_key"],
        unique=True,
        postgresql_where=sa.text("status = 'ACTIVE'"),
    )

    # 이미 Seed된 Database에도 권한을 반영한다. 다시 실행해도 중복되지 않는다.
    bind = op.get_bind()
    for code, description in PERMISSIONS.items():
        bind.execute(
            sa.text(
                "INSERT INTO iam.permissions (code, description_ko) "
                "SELECT CAST(:code AS VARCHAR(80)), CAST(:description AS VARCHAR(200)) "
                "WHERE NOT EXISTS (SELECT 1 FROM iam.permissions "
                "WHERE code = CAST(:code AS VARCHAR(80)))"
            ),
            {"code": code, "description": description},
        )
    bind.execute(
        sa.text(
            "INSERT INTO iam.role_permissions (role_id, permission_id) "
            "SELECT r.id, p.id FROM iam.roles r CROSS JOIN iam.permissions p "
            "WHERE r.code IN :roles AND p.code IN :codes "
            "AND NOT EXISTS (SELECT 1 FROM iam.role_permissions rp "
            "WHERE rp.role_id = r.id AND rp.permission_id = p.id)"
        ).bindparams(
            sa.bindparam("roles", expanding=True), sa.bindparam("codes", expanding=True)
        ),
        {"roles": list(GRANTED_ROLES), "codes": list(PERMISSIONS)},
    )


def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(
        sa.text(
            "DELETE FROM iam.role_permissions WHERE permission_id IN "
            "(SELECT id FROM iam.permissions WHERE code IN :codes)"
        ).bindparams(sa.bindparam("codes", expanding=True)),
        {"codes": list(PERMISSIONS)},
    )
    bind.execute(
        sa.text("DELETE FROM iam.permissions WHERE code IN :codes").bindparams(
            sa.bindparam("codes", expanding=True)
        ),
        {"codes": list(PERMISSIONS)},
    )
    op.drop_index("uq_medication_items_active_item", table_name=ITEMS)
    for column in (
        "ended_by_user_id",
        "hold_confirmed_by_user_id",
        "patient_notified_by_user_id",
        "recorded_by_user_id",
        "physician_profile_id",
        "status",
        "item_key",
        "review_id",
    ):
        op.drop_index(f"ix_{ITEMS}_{column}", table_name=ITEMS)
    op.drop_table(ITEMS)
    for column in ("saved_by_user_id", "review_id"):
        op.drop_index(f"ix_{REVISIONS}_{column}", table_name=REVISIONS)
    op.drop_table(REVISIONS)
    for column in ("updated_by_user_id", "confirmed_by_user_id", "appointment_id"):
        op.drop_index(f"ix_{REVIEWS}_{column}", table_name=REVIEWS)
    op.drop_table(REVIEWS)
