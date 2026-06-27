"""Add change_notes + revisions.change_notes_json

A planner-authored "what changed and why" note per resource (rig / HWU / general),
summarising the activity changes vs the last sequence. Captured into the revision
snapshot on submit (revisions.change_notes_json), so an approved revision records
the rationale alongside the activity snapshot.

Revision ID: 020
Revises: 019
Create Date: 2026-06-27
"""

import sqlalchemy as sa

from alembic import op

revision = "020"
down_revision = "019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "change_notes",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("resource_name", sa.String(128), nullable=True),
        sa.Column("body", sa.String(4000), nullable=False),
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
        sa.UniqueConstraint(
            "project_id", "kind", "resource_name", name="uq_change_note_project_kind_resource"
        ),
    )
    op.create_index("ix_change_notes_project_id", "change_notes", ["project_id"])
    op.add_column("revisions", sa.Column("change_notes_json", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("revisions", "change_notes_json")
    op.drop_index("ix_change_notes_project_id", table_name="change_notes")
    op.drop_table("change_notes")
