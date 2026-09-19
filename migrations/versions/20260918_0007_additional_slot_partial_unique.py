"""연장 Slot 유일성을 부분 Index로 좁힌다

Revision ID: 20260918_0007
Revises: 20260918_0006
Create Date: 2026-09-18

취소된 예약과 취소된 연장 Slot이 같은 시각을 영구히 점유하던 문제를 고친다.

- `appointments.additional_slot_id`의 전체 Unique Index를 Slot을 점유 중인
  예약(`occupies_slot`)만 대상으로 하는 부분 Unique Index로 바꾼다.
- `schedule_additional_slots`의 (Resource, 날짜, 시작시각) Unique 제약을
  `status = 'APPROVED'`인 Slot만 대상으로 하는 부분 Unique Index로 바꾼다.

Downgrade는 더 넓은 제약을 되살리므로, 취소 이력이 쌓인 Database에서는
Unique 위반으로 실패할 수 있다. 운영 Database에서는 Backup 후에만 실행한다.
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260918_0007"
down_revision: str | None = "20260918_0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


OCCUPIED_SLOT_WHERE = "occupies_slot AND additional_slot_id IS NOT NULL"
APPROVED_SLOT_WHERE = "status = 'APPROVED'"


def upgrade() -> None:
    # FK 조회용 Index는 남기고 Unique만 떼어낸다.
    op.drop_index("ix_appointments_additional_slot_id", table_name="appointments")
    op.create_index(
        "ix_appointments_additional_slot_id", "appointments", ["additional_slot_id"]
    )
    op.create_index(
        "uq_appointments_occupied_additional_slot",
        "appointments",
        ["additional_slot_id"],
        unique=True,
        postgresql_where=sa.text(OCCUPIED_SLOT_WHERE),
    )

    op.drop_constraint(
        "uq_schedule_additional_slots_resource_date_start",
        "schedule_additional_slots",
        type_="unique",
    )
    op.create_index(
        "uq_schedule_additional_slots_approved_start",
        "schedule_additional_slots",
        ["resource_id", "service_date", "start_time"],
        unique=True,
        postgresql_where=sa.text(APPROVED_SLOT_WHERE),
    )


def downgrade() -> None:
    op.drop_index(
        "uq_schedule_additional_slots_approved_start",
        table_name="schedule_additional_slots",
    )
    op.create_unique_constraint(
        "uq_schedule_additional_slots_resource_date_start",
        "schedule_additional_slots",
        ["resource_id", "service_date", "start_time"],
    )

    op.drop_index(
        "uq_appointments_occupied_additional_slot", table_name="appointments"
    )
    op.drop_index("ix_appointments_additional_slot_id", table_name="appointments")
    op.create_index(
        "ix_appointments_additional_slot_id",
        "appointments",
        ["additional_slot_id"],
        unique=True,
    )
