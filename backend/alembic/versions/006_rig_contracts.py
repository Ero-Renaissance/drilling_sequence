"""Rig contracts — backing the CON readiness check

Revision ID: 006
Revises: 005
Create Date: 2026-05-28
"""

from alembic import op
import sqlalchemy as sa


revision = "006"
down_revision = "005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "rig_contracts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("rig_name", sa.String(128), nullable=False),
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
        sa.UniqueConstraint("project_id", "rig_name", name="uq_rig_contract_project_rig"),
    )
    op.create_index("ix_rig_contracts_project_id", "rig_contracts", ["project_id"])


def downgrade() -> None:
    op.drop_index("ix_rig_contracts_project_id", table_name="rig_contracts")
    op.drop_table("rig_contracts")
