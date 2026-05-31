"""drop legacy flat per-activity readiness fields

Per-check readiness is modelled by the ReadinessCheck entity (one row per
activity + check_code, with a status), managed on the Readiness tab and driving
the chart's readiness icon strip. The flat Activity.readiness_check (a
comma-separated code string) and readiness_check_status were legacy: they never
fed the real per-check readiness and were unused for display, so they are dropped.

Revision ID: 013
Revises: 012
Create Date: 2026-05-31
"""

import sqlalchemy as sa
from alembic import op

revision = "013"
down_revision = "012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("activities", "readiness_check_status")
    op.drop_column("activities", "readiness_check")


def downgrade() -> None:
    op.add_column(
        "activities",
        sa.Column("readiness_check", sa.String(length=256), nullable=True),
    )
    op.add_column(
        "activities",
        sa.Column("readiness_check_status", sa.String(length=64), nullable=True),
    )
