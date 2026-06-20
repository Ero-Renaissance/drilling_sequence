"""Add projects.cloned_from_project_id (clone-parent link)

Revision ID: 011
Revises: 010
Create Date: 2026-05-30
"""

import sqlalchemy as sa

from alembic import op

revision = "011"
down_revision = "010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column("cloned_from_project_id", sa.Uuid(), nullable=True),
    )
    op.create_index(
        "ix_projects_cloned_from_project_id",
        "projects",
        ["cloned_from_project_id"],
    )
    # No ON DELETE action (NOT "SET NULL"): this is a self-referential FK, and SQL
    # Server forbids SET NULL/CASCADE on a self-reference (cycle risk, error 1785).
    # Projects are archived, not hard-deleted, so the action is never exercised.
    op.create_foreign_key(
        "fk_projects_cloned_from_project_id",
        "projects",
        "projects",
        ["cloned_from_project_id"],
        ["id"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_projects_cloned_from_project_id", "projects", type_="foreignkey"
    )
    op.drop_index("ix_projects_cloned_from_project_id", table_name="projects")
    op.drop_column("projects", "cloned_from_project_id")
