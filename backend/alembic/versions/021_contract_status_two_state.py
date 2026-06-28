"""Collapse contract status to the two-state model (Draft / Completed)

Rig + HWU contract status goes from (N/A, Not Started, In Progress, Completed) to
just (Draft, Completed): the three non-binding states all fold into "Draft";
"Completed" — the in-force state that binds the dates and drives the expiry
marker — is unchanged. Data-only: the status column's type and nullability are
untouched. New rows default to "Draft" via the model server_default; this
migration only backfills existing rows.

Revision ID: 021
Revises: 020
Create Date: 2026-06-28
"""

from alembic import op

revision = "021"
down_revision = "020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "UPDATE rig_contracts SET status = 'Draft' "
        "WHERE status IN ('N/A', 'Not Started', 'In Progress')"
    )
    op.execute(
        "UPDATE hwu_contracts SET status = 'Draft' "
        "WHERE status IN ('N/A', 'Not Started', 'In Progress')"
    )


def downgrade() -> None:
    # Lossy: the three non-binding states were collapsed into Draft, so restore
    # Draft to "Not Started" (the prior default non-binding state).
    op.execute("UPDATE rig_contracts SET status = 'Not Started' WHERE status = 'Draft'")
    op.execute("UPDATE hwu_contracts SET status = 'Not Started' WHERE status = 'Draft'")
