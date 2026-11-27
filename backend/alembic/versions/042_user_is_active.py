"""Users can be stopped from signing in.

``users`` gains ``is_active`` (Boolean, NOT NULL, default true). An admin turns
it off on the Admin page ("Block sign-in", audited ``user_blocked`` /
``user_unblocked``); a blocked user is refused at sign-in and on every request,
in every sign-in mode. It is how a person leaves the pilot sign-in list
(docs/deployment-guide.md Appendix E) without deleting the user row their
history points at. Every existing user stays active.

Downgrade drops the column: blocked users can sign in again.

Revision ID: 042
Revises: 041
Create Date: 2026-11-26
"""

import sqlalchemy as sa

from alembic import op

revision = "042"
down_revision = "041"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
    )


def _drop_column(table: str, column: str) -> None:
    """Portable DROP COLUMN (MSSQL requires dropping the DEFAULT constraint first —
    see migration 008 for the full rationale). Identifiers are fixed constants.
    Copied from migration 022: migrations never import each other."""
    if op.get_bind().dialect.name == "mssql":
        op.execute(
            f"DECLARE @c sysname; "
            f"SELECT @c = dc.name FROM sys.default_constraints dc "
            f"JOIN sys.columns col ON col.object_id = dc.parent_object_id "
            f"AND col.column_id = dc.parent_column_id "
            f"WHERE dc.parent_object_id = OBJECT_ID(N'{table}') AND col.name = N'{column}'; "
            f"IF @c IS NOT NULL EXEC('ALTER TABLE [{table}] DROP CONSTRAINT [' + @c + ']');"
        )
    op.drop_column(table, column)


def downgrade() -> None:
    _drop_column("users", "is_active")
