"""Add HWU (Hydraulic Workover Unit) — a resource parallel to Rig

Adds activities.hwu_name (an activity uses a rig OR an HWU, never both) and an
hwu_contracts table mirroring rig_contracts — including the status column that
rigs only gained in migration 007, so HWU contracts have it from the start.

Revision ID: 019
Revises: 018
Create Date: 2026-06-27
"""

import sqlalchemy as sa

from alembic import op

revision = "019"
down_revision = "018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "activities", sa.Column("hwu_name", sa.String(length=256), nullable=True)
    )
    op.create_table(
        "hwu_contracts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("hwu_name", sa.String(128), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="Not Started"),
        sa.Column("contract_start", sa.Date(), nullable=True),
        sa.Column("contract_end", sa.Date(), nullable=True),
        sa.Column("notes", sa.String(1024), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("updated_by", sa.Uuid(), nullable=True),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["updated_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("project_id", "hwu_name", name="uq_hwu_contract_project_hwu"),
    )
    op.create_index("ix_hwu_contracts_project_id", "hwu_contracts", ["project_id"])


def downgrade() -> None:
    op.drop_index("ix_hwu_contracts_project_id", table_name="hwu_contracts")
    op.drop_table("hwu_contracts")
    # Plain nullable column (no default/FK), so a direct drop is portable.
    op.drop_column("activities", "hwu_name")
