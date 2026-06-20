"""Phase 6: revision snapshots, signatures, activity locking

Revision ID: 004
Revises: 003
Create Date: 2026-05-25
"""

import sqlalchemy as sa

from alembic import op

revision = "004"
down_revision = "003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "revisions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("rev_number", sa.Integer(), nullable=False),
        sa.Column("label", sa.String(256), nullable=True),
        sa.Column("snapshot_json", sa.Text(), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_revisions_project_id", "revisions", ["project_id"])

    op.create_table(
        "signatures",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("revision_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("role_label", sa.String(128), nullable=False),
        sa.Column("signed_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["revision_id"], ["revisions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_signatures_revision_id", "signatures", ["revision_id"])

    op.add_column(
        "activities",
        sa.Column(
            "locked_by_revision_id",
            sa.Uuid(),
            # No ON DELETE action (NOT "SET NULL"): SQL Server (error 1785) rejects a
            # SET NULL/CASCADE FK here because projects -> activities and
            # projects -> revisions -> activities form multiple cascade paths. This is
            # safe: revisions are never hard-deleted (discard is a status change) and
            # activities are unlocked in app code (revisions._unlock_activities), so the
            # DB-level SET NULL was only ever a never-exercised backstop. Keeping it
            # actionless makes the schema portable across PostgreSQL/SQLite/MSSQL.
            sa.ForeignKey("revisions.id"),
            nullable=True,
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
    _drop_column("activities", "locked_by_revision_id")
    op.drop_index("ix_signatures_revision_id", table_name="signatures")
    op.drop_table("signatures")
    op.drop_index("ix_revisions_project_id", table_name="revisions")
    op.drop_table("revisions")
