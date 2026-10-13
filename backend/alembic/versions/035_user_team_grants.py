"""Global readiness team grants (Phase 2 of docs/readiness-framework-spec.md).

A ``user_team_grants`` row lets a user edit one readiness team's checks (e.g.
Logistics) in every campaign. Admin-curated; grant/revoke is audited in
``audit_logs`` (which also records who granted — hence no ``granted_by`` column:
a second cascading FK to ``users`` is a "multiple cascade paths" error on SQL
Server).

Revision ID: 035
Revises: 034
Create Date: 2026-10-13
"""

import sqlalchemy as sa

from alembic import op

revision = "035"
down_revision = "034"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_team_grants",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("team_code", sa.String(32), nullable=False),
        sa.Column(
            "granted_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["team_code"], ["readiness_teams.code"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "team_code", name="uq_user_team_grant"),
    )
    op.create_index("ix_user_team_grants_user_id", "user_team_grants", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_user_team_grants_user_id", table_name="user_team_grants")
    op.drop_table("user_team_grants")
