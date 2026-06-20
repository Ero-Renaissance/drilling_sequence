"""Add decision fields to revisions — reject / request-changes with reason

Revision ID: 009
Revises: 008
Create Date: 2026-05-29
"""

import sqlalchemy as sa

from alembic import op

revision = "009"
down_revision = "008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("revisions", sa.Column("decision_reason", sa.Text(), nullable=True))
    op.add_column(
        "revisions",
        sa.Column("decision_by", sa.Uuid(), nullable=True),
    )
    op.add_column(
        "revisions",
        sa.Column("decision_at", sa.DateTime(timezone=True), nullable=True),
    )
    # No ON DELETE action (NOT "SET NULL"): revisions.created_by -> users is already
    # SET NULL (migration 004), and SQL Server (error 1785) rejects a second cascade
    # path from the same table to the same parent. Users are sourced from Azure AD and
    # never hard-deleted, so a DB-level SET NULL here is never exercised anyway.
    op.create_foreign_key(
        "fk_revisions_decision_by_users",
        "revisions",
        "users",
        ["decision_by"],
        ["id"],
    )


def downgrade() -> None:
    op.drop_constraint("fk_revisions_decision_by_users", "revisions", type_="foreignkey")
    op.drop_column("revisions", "decision_at")
    op.drop_column("revisions", "decision_by")
    op.drop_column("revisions", "decision_reason")
