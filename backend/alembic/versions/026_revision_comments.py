"""Revision deliberation thread (revision_comments).

A designated reviewer/approver, the planner, or an admin can record context on
a PENDING revision without ending its pending state — previously the only free
text in the workflow was the decision reason, which exists only on
reject/request-changes (commenting meant declining). Append-only; org-wide
readable; the thread stays attached to the revision after resolution as part
of the approval record.

Revision ID: 026
Revises: 025
Create Date: 2026-07-12
"""

import sqlalchemy as sa

from alembic import op

revision = "026"
down_revision = "025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "revision_comments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("revision_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("author_role", sa.String(32), nullable=False),
        sa.Column("stage", sa.String(16), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        # NOT NULL, populated by the ORM default (like revisions.created_at).
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["revision_id"], ["revisions.id"], ondelete="CASCADE"),
        # SET NULL (not CASCADE) mirrors signatures: users are never hard-deleted,
        # and a single users path per table keeps MSSQL's multiple-cascade rule happy.
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_revision_comments_revision_id", "revision_comments", ["revision_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_revision_comments_revision_id", table_name="revision_comments")
    op.drop_table("revision_comments")
