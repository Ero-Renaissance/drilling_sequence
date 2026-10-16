"""Reconcile indexes with the models, so ``alembic check`` is clean on SQL Server.

- ``audit_logs.project_id`` and ``audit_logs.timestamp`` get the indexes the model
  has always declared but no migration created. ``project_id`` is the audit view's
  filter and a cascade-delete foreign key (neither SQL Server nor PostgreSQL
  indexes a foreign key on its own); ``timestamp`` is the view's sort order.
- ``users``: migration 001 built a unique constraint AND a plain index on each of
  ``ad_object_id`` and ``email``. The constraint's own unique index already serves
  the lookups, so the plain ``ix_users_*`` indexes are redundant write cost; they go.

Column-width differences were reconciled on the model side (the deployed widths
are the right ones), so no column changes here.

SQL Server refuses ALTER COLUMN on an indexed column: a later migration that
alters ``audit_logs.project_id`` or ``.timestamp`` must drop these indexes first.

Revision ID: 037
Revises: 036
Create Date: 2026-10-16
"""

from alembic import op

revision = "037"
down_revision = "036"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index("ix_audit_logs_project_id", "audit_logs", ["project_id"])
    op.create_index("ix_audit_logs_timestamp", "audit_logs", ["timestamp"])
    op.drop_index("ix_users_ad_object_id", table_name="users")
    op.drop_index("ix_users_email", table_name="users")


def downgrade() -> None:
    op.create_index("ix_users_email", "users", ["email"])
    op.create_index("ix_users_ad_object_id", "users", ["ad_object_id"])
    op.drop_index("ix_audit_logs_timestamp", table_name="audit_logs")
    op.drop_index("ix_audit_logs_project_id", table_name="audit_logs")
