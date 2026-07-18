"""Key notes: the planner's campaign bulletin on the Overview page.

Plain text (max 4000 — the client renders the bullet/numbered lists subset),
with who/when accountability columns. Nullable throughout: existing campaigns
simply have no key notes yet.

Revision ID: 031
Revises: 030
Create Date: 2026-07-18
"""

import sqlalchemy as sa

from alembic import op

revision = "031"
down_revision = "030"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("projects", sa.Column("key_notes", sa.String(4000), nullable=True))
    op.add_column(
        "projects",
        sa.Column("key_notes_updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "projects",
        sa.Column("key_notes_updated_by", sa.Uuid(), nullable=True),
    )
    # SQLite cannot ALTER-add a constraint (and treats FKs as advisory anyway);
    # scratch verification DBs skip it, real backends get the named FK.
    if op.get_bind().dialect.name != "sqlite":
        op.create_foreign_key(
            "fk_projects_key_notes_updated_by_users",
            "projects",
            "users",
            ["key_notes_updated_by"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    if op.get_bind().dialect.name != "sqlite":
        op.drop_constraint(
            "fk_projects_key_notes_updated_by_users", "projects", type_="foreignkey"
        )
    with op.batch_alter_table("projects") as batch:
        batch.drop_column("key_notes_updated_by")
        batch.drop_column("key_notes_updated_at")
        batch.drop_column("key_notes")
