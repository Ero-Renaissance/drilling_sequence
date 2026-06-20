"""add activities table

Revision ID: 002
Revises: 001
Create Date: 2026-05-24
"""

import sqlalchemy as sa

from alembic import op

revision = "002"
down_revision = "001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "activities",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("activity_type", sa.String(256), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.Column("well_name", sa.String(256), nullable=True),
        sa.Column("rig_name", sa.String(256), nullable=True),
        sa.Column("project_group", sa.String(256), nullable=True),
        sa.Column("location", sa.String(64), nullable=True),
        sa.Column("readiness_check", sa.Text(), nullable=True),
        sa.Column("readiness_check_status", sa.String(64), nullable=True),
        sa.Column("risk", sa.String(64), nullable=True),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("plan_type", sa.String(64), nullable=True),
        sa.Column("rig_contract_expiry_date", sa.Date(), nullable=True),
        sa.Column("rig_contract_days_remaining", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            # Dialect-translated; literal text("now()") would fail on MSSQL.
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_activities_project_id", "activities", ["project_id"])
    op.create_index("ix_activities_start_date", "activities", ["start_date"])


def downgrade() -> None:
    op.drop_index("ix_activities_start_date", table_name="activities")
    op.drop_index("ix_activities_project_id", table_name="activities")
    op.drop_table("activities")
