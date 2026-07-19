"""At most one open (pending) revision per project — a filtered unique index.

The submit handler's "no open revision" check is a read-then-insert with a wide
await window (snapshot build, conflict detection); under concurrency two submits
could both pass it and open two revisions on one project. The DB must be the
authority. Filtered/partial unique index so only pending rows are constrained —
a project accumulates many approved/rejected/discarded revisions over its life,
which must never collide.

Verified on the live MSSQL 2022 container (READ COMMITTED, RCSI off): the index
rejects a second pending revision while allowing a second approved one.

Revision ID: 032
Revises: 031
Create Date: 2026-07-20
"""

import sqlalchemy as sa

from alembic import op

revision = "032"
down_revision = "031"
branch_labels = None
depends_on = None

_OPEN = "status IN ('pending_review', 'pending_approval')"


def upgrade() -> None:
    # MSSQL filtered index and SQLite/Postgres partial index share the same
    # predicate; each dialect keyword is ignored by the others. The parity
    # harness no-ops create_index, so this is model-only there.
    op.create_index(
        "uq_open_revision_per_project",
        "revisions",
        ["project_id"],
        unique=True,
        mssql_where=sa.text(_OPEN),
        sqlite_where=sa.text(_OPEN),
        postgresql_where=sa.text(_OPEN),
    )


def downgrade() -> None:
    op.drop_index("uq_open_revision_per_project", table_name="revisions")
