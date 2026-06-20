"""Scaffold the two-stage review→approval workflow

Adds the columns the optional technical-review stage needs, with no behaviour
change yet (the routing/endpoints land in a later change):

- projects.review_policy        — required | optional | off  (default optional)
- revisions.review_required     — was this revision routed through review
- project_approvers.kind        — approver | reviewer (generalises the signer
                                  matrix); the unique key widens to include kind
- signatures.stage              — approval | review (one table, two stages)

The new revision status value "pending_review" needs no migration — status is a
free String(32) column.

Stored as plain strings (allow-lists enforced in Pydantic) and sa.false() for the
boolean, to stay portable across Postgres and MSSQL. See
docs/review-approval-workflow-spec.md.

Revision ID: 014
Revises: 013
Create Date: 2026-06-01
"""

import sqlalchemy as sa

from alembic import op

revision = "014"
down_revision = "013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column(
            "review_policy",
            sa.String(length=16),
            nullable=False,
            server_default="optional",
        ),
    )
    op.add_column(
        "revisions",
        sa.Column(
            "review_required",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.add_column(
        "signatures",
        sa.Column(
            "stage",
            sa.String(length=16),
            nullable=False,
            server_default="approval",
        ),
    )

    # Generalise the designated-signer matrix: existing rows are approvers.
    op.add_column(
        "project_approvers",
        sa.Column(
            "kind",
            sa.String(length=16),
            nullable=False,
            server_default="approver",
        ),
    )
    # An email may now appear once per kind per project (reviewer and/or approver).
    op.drop_constraint(
        "uq_project_approver_email", "project_approvers", type_="unique"
    )
    op.create_unique_constraint(
        "uq_project_approver_email_kind",
        "project_approvers",
        ["project_id", "email", "kind"],
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
    op.drop_constraint(
        "uq_project_approver_email_kind", "project_approvers", type_="unique"
    )
    op.create_unique_constraint(
        "uq_project_approver_email",
        "project_approvers",
        ["project_id", "email"],
    )
    _drop_column("project_approvers", "kind")
    _drop_column("signatures", "stage")
    _drop_column("revisions", "review_required")
    _drop_column("projects", "review_policy")
