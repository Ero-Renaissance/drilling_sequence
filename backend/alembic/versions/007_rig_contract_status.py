"""Workflow status on rig_contracts — dates only count when status = Completed

Revision ID: 007
Revises: 006
Create Date: 2026-05-28
"""

from alembic import op
import sqlalchemy as sa


revision = "007"
down_revision = "006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add the status column with a sensible default so existing rows are valid.
    # New rows from the API will get a value via the Pydantic schema default.
    op.add_column(
        "rig_contracts",
        sa.Column(
            "status",
            sa.String(32),
            nullable=False,
            server_default="Not Started",
        ),
    )


def downgrade() -> None:
    op.drop_column("rig_contracts", "status")
