"""drop legacy per-activity rig-contract fields

A rig has exactly one contract per project, modelled by the RigContract entity
(UniqueConstraint(project_id, rig_name)) with contract_start + contract_end. The
denormalised per-activity rig_contract_expiry_date / rig_contract_days_remaining
were legacy (end-only, plus a derived days value) and unused for display, so they
are dropped. Contract dates now live solely on rig_contracts.

Revision ID: 012
Revises: 011
Create Date: 2026-05-31
"""

import sqlalchemy as sa

from alembic import op

revision = "012"
down_revision = "011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("activities", "rig_contract_days_remaining")
    op.drop_column("activities", "rig_contract_expiry_date")


def downgrade() -> None:
    op.add_column(
        "activities",
        sa.Column("rig_contract_expiry_date", sa.Date(), nullable=True),
    )
    op.add_column(
        "activities",
        sa.Column("rig_contract_days_remaining", sa.Integer(), nullable=True),
    )
