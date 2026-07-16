"""Readiness moves from per-activity to per FIELD-DEVELOPMENT PROJECT.

FDP/FID/EIA/BUD etc. are sanction gates for a field-development project as a
whole (every well under "Bonga Phase 3" shares one FID), not attributes of each
activity. This drops the per-activity ``readiness_checks`` table and creates
``project_readiness`` keyed by (campaign, well_project, gate).

Pre-deployment, so this is a clean recreate — existing per-activity readiness
(dev/test data) is not migrated; readiness is re-entered per project via the
editor or the reworked import. Approved-revision snapshots are immutable and
keep their per-activity readiness block; readers stay faithful to it.

Revision ID: 029
Revises: 028
Create Date: 2026-07-15
"""

import sqlalchemy as sa

from alembic import op

revision = "029"
down_revision = "028"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_table("readiness_checks")
    op.create_table(
        "project_readiness",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("well_project", sa.String(256), nullable=False),
        sa.Column("check_code", sa.String(16), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="On Track"),
        sa.Column("notes", sa.String(512), nullable=True),
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
            "project_id", "well_project", "check_code", name="uq_project_readiness_gate"
        ),
    )
    op.create_index(
        "ix_project_readiness_project_id", "project_readiness", ["project_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_project_readiness_project_id", table_name="project_readiness")
    op.drop_table("project_readiness")
    op.create_table(
        "readiness_checks",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("activity_id", sa.Uuid(), nullable=False),
        sa.Column("check_code", sa.String(16), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="On Track"),
        sa.Column("notes", sa.String(512), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["activity_id"], ["activities.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("activity_id", "check_code", name="uq_readiness_activity_check"),
    )
    op.create_index("ix_readiness_checks_activity_id", "readiness_checks", ["activity_id"])
