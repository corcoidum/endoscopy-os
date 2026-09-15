"""위·대장 동시검사의 세트60·세트90 선택값 추가

Revision ID: 20260915_0004
Revises: 20260909_0003
Create Date: 2026-09-15
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260915_0004"
down_revision: str | None = "20260909_0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "appointments",
        sa.Column("procedure_set", sa.String(length=20), nullable=True),
    )
    op.create_check_constraint(
        "ck_appointments_procedure_set",
        "appointments",
        "procedure_set IS NULL OR procedure_set IN ('SET_60','SET_90')",
    )
    op.execute(
        """
        UPDATE appointments AS appointment
        SET procedure_set = 'SET_60'
        WHERE EXISTS (
            SELECT 1 FROM appointment_procedures AS procedure
            WHERE procedure.appointment_id = appointment.id
              AND procedure.procedure_code = 'UPPER'
        )
        AND EXISTS (
            SELECT 1 FROM appointment_procedures AS procedure
            WHERE procedure.appointment_id = appointment.id
              AND procedure.procedure_code = 'COLON'
        )
        """
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_appointments_procedure_set",
        "appointments",
        type_="check",
    )
    op.drop_column("appointments", "procedure_set")
