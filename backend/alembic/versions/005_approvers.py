"""Configurable per-project required approvers

Revision ID: 005
Revises: 004
Create Date: 2026-05-25
"""

from alembic import op
import sqlalchemy as sa

revision = "005"
down_revision = "004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "project_approvers",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("email", sa.String(256), nullable=False),
        sa.Column("name", sa.String(256), nullable=True),
        sa.Column("role_label", sa.String(128), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("project_id", "email", name="uq_project_approver_email"),
    )
    op.create_index("ix_project_approvers_project_id", "project_approvers", ["project_id"])


def downgrade() -> None:
    op.drop_index("ix_project_approvers_project_id", table_name="project_approvers")
    op.drop_table("project_approvers")
