"""Add is_admin flag to users — global admin role

Revision ID: 008
Revises: 007
Create Date: 2026-05-28
"""

from alembic import op
import sqlalchemy as sa


revision = "008"
down_revision = "007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "is_admin",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def _drop_column(table: str, column: str) -> None:
    """Portable DROP COLUMN.

    SQL Server blocks DROP COLUMN while a DEFAULT or FOREIGN KEY constraint still
    references the column (auto-named ``DF__``/``FK__``; errors 5074/4922), so drop
    those first. On PostgreSQL/SQLite they travel with the column and a direct drop
    works, so the preamble is MSSQL-only. Identifiers are fixed migration constants,
    never user input.
    """
    if op.get_bind().dialect.name == "mssql":
        op.execute(
            f"DECLARE @c sysname; "
            f"SELECT @c = dc.name FROM sys.default_constraints dc "
            f"JOIN sys.columns col ON col.object_id = dc.parent_object_id "
            f"AND col.column_id = dc.parent_column_id "
            f"WHERE dc.parent_object_id = OBJECT_ID(N'{table}') AND col.name = N'{column}'; "
            f"IF @c IS NOT NULL EXEC('ALTER TABLE [{table}] DROP CONSTRAINT [' + @c + ']'); "
            f"SET @c = NULL; "
            f"SELECT @c = fk.name FROM sys.foreign_keys fk "
            f"JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id "
            f"JOIN sys.columns col ON col.object_id = fkc.parent_object_id "
            f"AND col.column_id = fkc.parent_column_id "
            f"WHERE fk.parent_object_id = OBJECT_ID(N'{table}') AND col.name = N'{column}'; "
            f"IF @c IS NOT NULL EXEC('ALTER TABLE [{table}] DROP CONSTRAINT [' + @c + ']');"
        )
    op.drop_column(table, column)


def downgrade() -> None:
    _drop_column("users", "is_admin")
