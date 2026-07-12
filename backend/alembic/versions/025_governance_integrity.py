"""Governance integrity: global audit events + DB-enforced signing invariants.

Two audit-hardening changes from the security review:

* ``audit_logs.project_id`` becomes NULLABLE. Global governance events —
  admin grants/revokes and the ``can_plan`` planner grant — previously had
  nowhere to go (the column was project-scoped NOT NULL), so privilege changes
  lived only in transient process logs. NULL project_id now means "global
  event"; the admin router records them via governance_event.

* Uniqueness the app previously enforced only with racy read-then-insert
  checks moves into the schema, where the approval record actually lives:
  - signatures: one per (revision, user, stage) — duplicates would pollute
    the signature record and its integrity digest;
  - revisions: one (project, rev_number) — the revision sequence is the
    approval record's spine.

Defensive dedupe runs first (in Python, cross-backend) so the constraints
can't fail on pre-existing duplicate rows; survivors are the earliest signed /
first created. Any dropped duplicate is data the app should never have let in.

Revision ID: 025
Revises: 024
Create Date: 2026-07-12
"""

import sqlalchemy as sa

from alembic import op

revision = "025"
down_revision = "024"
branch_labels = None
depends_on = None


def _dedupe(bind: sa.engine.Connection) -> None:
    signatures = sa.table(
        "signatures",
        sa.column("id", sa.Uuid()),
        sa.column("revision_id", sa.Uuid()),
        sa.column("user_id", sa.Uuid()),
        sa.column("stage", sa.String()),
        sa.column("signed_at", sa.DateTime(timezone=True)),
    )
    seen: set[tuple] = set()
    for row in bind.execute(
        sa.select(
            signatures.c.id, signatures.c.revision_id, signatures.c.user_id, signatures.c.stage
        ).order_by(signatures.c.signed_at)
    ).all():
        key = (row.revision_id, row.user_id, row.stage)
        if key in seen:
            bind.execute(signatures.delete().where(signatures.c.id == row.id))
        else:
            seen.add(key)

    revisions = sa.table(
        "revisions",
        sa.column("id", sa.Uuid()),
        sa.column("project_id", sa.Uuid()),
        sa.column("rev_number", sa.Integer()),
        sa.column("created_at", sa.DateTime(timezone=True)),
    )
    rows = bind.execute(
        sa.select(revisions.c.id, revisions.c.project_id, revisions.c.rev_number).order_by(
            revisions.c.created_at
        )
    ).all()
    numbers_by_project: dict = {}
    for row in rows:
        numbers_by_project.setdefault(row.project_id, set()).add(row.rev_number)
    seen_rev: set[tuple] = set()
    for row in rows:
        key = (row.project_id, row.rev_number)
        if key in seen_rev:
            # Renumber the later duplicate past the project's max — never delete
            # a revision row (it may carry an approved snapshot).
            new_number = max(numbers_by_project[row.project_id]) + 1
            numbers_by_project[row.project_id].add(new_number)
            bind.execute(
                revisions.update()
                .where(revisions.c.id == row.id)
                .values(rev_number=new_number)
            )
        else:
            seen_rev.add(key)


def upgrade() -> None:
    bind = op.get_bind()
    # The model-parity test replays upgrades against a schema recorder whose
    # fake bind can't execute queries — skip the data dedupe there only.
    if hasattr(bind, "execute"):
        _dedupe(bind)

    # Batch mode so this ALSO runs on the SQLite dev database (a table rebuild
    # there; plain ALTERs on PostgreSQL / SQL Server). SQL Server refuses
    # ALTER COLUMN on an INDEXED column — safe here: migration 003 created no
    # index on audit_logs.project_id (only entity_id), and the FK alone does
    # not block a nullability change.
    with op.batch_alter_table("audit_logs") as batch:
        batch.alter_column("project_id", existing_type=sa.Uuid(), nullable=True)
    with op.batch_alter_table("signatures") as batch:
        batch.create_unique_constraint(
            "uq_signature_revision_user_stage", ["revision_id", "user_id", "stage"]
        )
    with op.batch_alter_table("revisions") as batch:
        batch.create_unique_constraint(
            "uq_revision_project_number", ["project_id", "rev_number"]
        )


def downgrade() -> None:
    with op.batch_alter_table("revisions") as batch:
        batch.drop_constraint("uq_revision_project_number", type_="unique")
    with op.batch_alter_table("signatures") as batch:
        batch.drop_constraint("uq_signature_revision_user_stage", type_="unique")
    # Global (NULL-project) audit rows must be removed before the column can
    # tighten back to NOT NULL.
    bind = op.get_bind()
    if hasattr(bind, "execute"):
        bind.execute(sa.text("DELETE FROM audit_logs WHERE project_id IS NULL"))
    with op.batch_alter_table("audit_logs") as batch:
        batch.alter_column("project_id", existing_type=sa.Uuid(), nullable=False)
