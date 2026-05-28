"""Add decision fields to revisions — reject / request-changes with reason

Revision ID: 009
Revises: 008
Create Date: 2026-05-29
"""

from alembic import op
import sqlalchemy as sa


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
    op.create_foreign_key(
        "fk_revisions_decision_by_users",
        "revisions",
        "users",
        ["decision_by"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_revisions_decision_by_users", "revisions", type_="foreignkey")
    op.drop_column("revisions", "decision_at")
    op.drop_column("revisions", "decision_by")
    op.drop_column("revisions", "decision_reason")
