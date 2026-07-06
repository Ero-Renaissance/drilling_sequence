"""Add can_plan flag to users — the global planner grant

An admin grants can_plan per user; only grant holders (and admins) may create
campaigns or hold the planner role. Backfill: everyone who already holds a
planner role on any campaign keeps their ability — they get the grant.

Revision ID: 022
Revises: 021
Create Date: 2026-07-06
"""

import sqlalchemy as sa

from alembic import op

revision = "022"
down_revision = "021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "can_plan",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )

    # Backfill: current planners keep planning. Dialect-portable via SQLAlchemy
    # expressions (boolean literals differ between MSSQL/Postgres/SQLite).
    users = sa.table("users", sa.column("id"), sa.column("can_plan"))
    members = sa.table("project_members", sa.column("user_id"), sa.column("role"))
    op.execute(
        users.update()
        .where(
            users.c.id.in_(
                sa.select(members.c.user_id).where(members.c.role == "planner")
            )
        )
        .values(can_plan=sa.true())
    )


def _drop_column(table: str, column: str) -> None:
    """Portable DROP COLUMN (MSSQL requires dropping the DEFAULT constraint first —
    see migration 008 for the full rationale). Identifiers are fixed constants."""
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
    _drop_column("users", "can_plan")
