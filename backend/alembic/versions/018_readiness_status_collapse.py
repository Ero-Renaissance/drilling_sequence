"""Backfill readiness_checks.status to the collapsed 3-state model

Readiness statuses go from (Not Started, In Progress, Completed, Behind, N/A) to
(On Track, Completed, Behind, N/A): "Not Started" and "In Progress" both fold
into "On Track"; Completed / Behind / N/A are unchanged. Data-only — the status
column's type and nullability are untouched.

Revision ID: 018
Revises: 017
Create Date: 2026-06-27
"""

from alembic import op

revision = "018"
down_revision = "017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "UPDATE readiness_checks SET status = 'On Track' "
        "WHERE status IN ('Not Started', 'In Progress')"
    )


def downgrade() -> None:
    # Lossy: the Not Started vs In Progress split was collapsed, so restore
    # On Track to In Progress (the prior "active" state).
    op.execute(
        "UPDATE readiness_checks SET status = 'In Progress' WHERE status = 'On Track'"
    )
