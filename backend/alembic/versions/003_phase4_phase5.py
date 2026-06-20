"""Phase 4 readiness checks + Phase 5 edit safety (audit log, presence, updated_by)

Revision ID: 003
Revises: 002
Create Date: 2026-05-25
"""

import sqlalchemy as sa

from alembic import op

revision = "003"
down_revision = "002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ---------- Phase 4: readiness checks ----------
    op.create_table(
        "readiness_checks",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("activity_id", sa.Uuid(), nullable=False),
        sa.Column("check_code", sa.String(32), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="Not Started"),
        sa.Column("notes", sa.Text(), nullable=True),
        # server_default mirrors the model (create_all): on MSSQL the table is built
        # from this migration, so without it inserts that omit the column get NULL.
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=True,
        ),
        sa.ForeignKeyConstraint(["activity_id"], ["activities.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("activity_id", "check_code", name="uq_readiness_activity_check"),
    )
    op.create_index("ix_readiness_activity_id", "readiness_checks", ["activity_id"])

    # ---------- Phase 5: audit log ----------
    op.create_table(
        "audit_logs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("entity_type", sa.String(64), nullable=False),
        sa.Column("entity_id", sa.Uuid(), nullable=False),
        sa.Column("field", sa.String(128), nullable=False),
        sa.Column("old_value", sa.Text(), nullable=True),
        sa.Column("new_value", sa.Text(), nullable=True),
        # server_default mirrors the model (create_all): without it, NOT NULL +
        # no default means every audit insert fails on MSSQL (NULL into timestamp).
        sa.Column(
            "timestamp",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_audit_logs_entity_id", "audit_logs", ["entity_id"])

    # ---------- Phase 5: presence / viewers ----------
    op.create_table(
        "project_viewers",
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        # server_default mirrors the model (create_all): NOT NULL + no default makes
        # presence inserts fail on MSSQL otherwise.
        sa.Column(
            "last_seen_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("project_id", "user_id"),
    )

    # ---------- Phase 5: updated_by on activities ----------
    op.add_column(
        "activities",
        sa.Column(
            "updated_by",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
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
    _drop_column("activities", "updated_by")
    op.drop_table("project_viewers")
    op.drop_index("ix_audit_logs_entity_id", table_name="audit_logs")
    op.drop_table("audit_logs")
    op.drop_index("ix_readiness_activity_id", table_name="readiness_checks")
    op.drop_table("readiness_checks")
