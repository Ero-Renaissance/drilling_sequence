"""Persist review_skipped on the revision.

It was derived at read time from the project's LIVE review_policy, so flipping
the policy retroactively rewrote whether historical revisions displayed
"review/endorsement skipped" — the approval record must not mutate. Freeze it as
a stored boolean set at submit. Existing rows default to False (not skipped),
which is the safe reading: a historical revision that genuinely bypassed review
will show accurately from its next submit onward, and none is falsely flagged.

Revision ID: 033
Revises: 032
Create Date: 2026-07-20
"""

import sqlalchemy as sa

from alembic import op

revision = "033"
down_revision = "032"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "revisions",
        sa.Column(
            "review_skipped",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column("revisions", "review_skipped")
