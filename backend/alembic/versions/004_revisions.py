"""Phase 6: revision snapshots, signatures, activity locking

Revision ID: 004
Revises: 003
Create Date: 2026-05-25
"""

from alembic import op
import sqlalchemy as sa

revision = "004"
down_revision = "003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "revisions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("rev_number", sa.Integer(), nullable=False),
        sa.Column("label", sa.String(256), nullable=True),
        sa.Column("snapshot_json", sa.Text(), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_revisions_project_id", "revisions", ["project_id"])

    op.create_table(
        "signatures",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("revision_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("role_label", sa.String(128), nullable=False),
        sa.Column("signed_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["revision_id"], ["revisions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_signatures_revision_id", "signatures", ["revision_id"])

    op.add_column(
        "activities",
        sa.Column(
            "locked_by_revision_id",
            sa.Uuid(),
            sa.ForeignKey("revisions.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("activities", "locked_by_revision_id")
    op.drop_index("ix_signatures_revision_id", table_name="signatures")
    op.drop_table("signatures")
    op.drop_index("ix_revisions_project_id", table_name="revisions")
    op.drop_table("revisions")
