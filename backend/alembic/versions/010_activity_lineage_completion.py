"""Add activity lineage_id (cross-clone identity) and completed_at

Revision ID: 010
Revises: 009
Create Date: 2026-05-29
"""

from alembic import op
import sqlalchemy as sa


revision = "010"
down_revision = "009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("activities", sa.Column("lineage_id", sa.Uuid(), nullable=True))
    op.add_column(
        "activities",
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_activities_lineage_id", "activities", ["lineage_id"])
    # Backfill: existing rows are their own lineage root.
    op.execute("UPDATE activities SET lineage_id = id WHERE lineage_id IS NULL")


def downgrade() -> None:
    op.drop_index("ix_activities_lineage_id", table_name="activities")
    op.drop_column("activities", "completed_at")
    op.drop_column("activities", "lineage_id")
