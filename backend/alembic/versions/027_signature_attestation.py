"""Signature attestation: record WHAT the signer declared they reviewed.

Signing was a bare row (who/when/role). Each new signature now also stores the
server-owned attestation sentence — stage-appropriate wording plus the resolved
baseline ("...against the last approved plan (Rev. 02)...") — so the durable
record carries the signer's declaration, not just the fact of a click.
Nullable: signatures predating this migration have no attestation.

Revision ID: 027
Revises: 026
Create Date: 2026-07-12
"""

import sqlalchemy as sa

from alembic import op

revision = "027"
down_revision = "026"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "signatures", sa.Column("attestation", sa.String(512), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("signatures", "attestation")
