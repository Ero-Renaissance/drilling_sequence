"""Add activities.project — the development project a well is tied to

The new schedule upload carries a per-well Project grouping (a development project
owns many wells). Stored as a dedicated nullable string column on activities,
distinct from the legacy free-text project_group. Plain nullable column (no default,
no FK), so the add/drop is portable across PostgreSQL / SQL Server / SQLite.

Revision ID: 016
Revises: 015
Create Date: 2026-06-19
"""

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "016"
down_revision = "015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("activities", sa.Column("well_project", sa.String(length=256), nullable=True))


def downgrade() -> None:
    op.drop_column("activities", "well_project")
