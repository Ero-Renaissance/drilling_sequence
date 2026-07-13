"""Activity-type aliases + the Well Testing → Well Cleanup/Test rename.

Two vocabulary changes from the import-mapping work:

* ``activity_type_aliases`` — remembered import mappings (normalized sheet
  wording → canonical type). Written by the import dialog's "remember this
  mapping"; read by every subsequent upload. Org-wide.

* The catalogue label "Well Testing" becomes "Well Cleanup/Test" (the field
  wording). LIVE activity rows are updated so the plan and legend read the new
  name; approved revision snapshots are IMMUTABLE and keep the old wording —
  the frontend colour lookup and the builtin alias keep both rendering and
  re-importing correctly forever.

Revision ID: 028
Revises: 027
Create Date: 2026-07-13
"""

import sqlalchemy as sa

from alembic import op

revision = "028"
down_revision = "027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "activity_type_aliases",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("alias_key", sa.String(128), nullable=False),
        sa.Column("alias_display", sa.String(128), nullable=False),
        sa.Column("canonical", sa.String(128), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("alias_key", name="uq_activity_type_alias_key"),
    )

    bind = op.get_bind()
    # The model-parity test replays upgrades against a schema recorder whose
    # fake bind can't execute queries — skip the data step there only.
    if hasattr(bind, "execute"):
        bind.execute(
            sa.text(
                "UPDATE activities SET activity_type = 'Well Cleanup/Test' "
                "WHERE activity_type = 'Well Testing'"
            )
        )


def downgrade() -> None:
    bind = op.get_bind()
    if hasattr(bind, "execute"):
        bind.execute(
            sa.text(
                "UPDATE activities SET activity_type = 'Well Testing' "
                "WHERE activity_type = 'Well Cleanup/Test'"
            )
        )
    op.drop_table("activity_type_aliases")
