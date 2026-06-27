"""Add activities.readiness_required — per-activity "track readiness?" toggle

When False the activity opts out of readiness: its gate icons are suppressed on
the chart + print-out and it's excluded from the dashboard readiness KPIs.
Defaults TRUE (server_default) so every existing row keeps its gates and the
column can be NOT NULL without a backfill.

Revision ID: 017
Revises: 016
Create Date: 2026-06-27
"""

import sqlalchemy as sa

from alembic import op

revision = "017"
down_revision = "016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "activities",
        sa.Column(
            "readiness_required",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
    )


def _drop_column(table: str, column: str) -> None:
    """Portable DROP COLUMN.

    SQL Server blocks DROP COLUMN while a DEFAULT constraint still references the
    column (auto-named ``DF__``; error 5074), so drop it first. On PostgreSQL /
    SQLite the default travels with the column and a direct drop works, so the
    preamble is MSSQL-only. Identifiers are fixed migration constants, never user
    input.
    """
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
    _drop_column("activities", "readiness_required")
