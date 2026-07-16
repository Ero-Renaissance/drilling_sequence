"""Activity gains a Market column (project-level assignment on rows).

Each field-development project is destined for a market — Oil, Domestic Gas,
Export Gas or Not Applicable. Like well_project itself, the value is
denormalised onto activity rows (there is no project master table); the import
enforces one value per project. Nullable: existing rows stay unset until the
planner assigns one.

Revision ID: 030
Revises: 029
Create Date: 2026-07-17
"""

import sqlalchemy as sa

from alembic import op

revision = "030"
down_revision = "029"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("activities", sa.Column("market", sa.String(32), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("activities") as batch:
        batch.drop_column("market")
