"""Readiness moves from a hard-coded enum to an admin-curated catalog.

Phase 1 of docs/readiness-framework-spec.md — no visible change:

- ``readiness_teams`` + ``readiness_checks``: the catalog, seeded with the
  "projects" team and the original seven field-project gates (same codes, labels,
  icons, order).
- ``readiness_entries`` replaces ``project_readiness``. It already carries the
  well-scope key columns (``scope``, ``well_name``, ``activity_type``) so Phase 3
  needs no further table change; existing gates move over as ``scope="project"``
  with the "" sentinel. Rows whose code is outside the seven are not carried
  over — none are expected, as the PUT allow-listed the seven since 029.
- ``revisions.catalog_json``: the check definitions frozen at submit. Existing
  revisions stay NULL and readers fall back to the built-in seven gates.

The seed rows are written out literally (not imported from app.models) so a later
change to the model constants can never rewrite what this migration did;
tests/test_readiness_catalog.py asserts the two still agree.

Revision ID: 034
Revises: 033
Create Date: 2026-10-13
"""

import uuid

import sqlalchemy as sa

from alembic import op

revision = "034"
down_revision = "033"
branch_labels = None
depends_on = None

SEED_TEAMS = (
    {
        "code": "projects",
        "name": "Projects",
        "editor_source": "planner",
        "icon_key": "land-plot",
        "sort_order": 0,
        "is_active": True,
    },
)

# (code, label, icon_key, sort_order) — all: projects team, project scope only,
# "standard" status set, governed (locks with the plan), no tag list.
SEED_GATES = (
    ("FDP", "Field Development Plan", "land-plot", 10),
    ("LLI", "Long Lead Items", "rotary-table", 20),
    ("LOC", "Location", "map-pin", 30),
    ("FE", "Wells Front End", "drafting-compass", 40),
    ("FID", "Final Inv. Decision", "gavel", 50),
    ("EIA", "Env. Assessment", "leaf", 60),
    ("BUD", "Budget", "banknote", 70),
)


def seed_checks() -> list[dict]:
    return [
        {
            "code": code,
            "label": label,
            "team_code": "projects",
            "applies_project": True,
            "applies_well": False,
            "status_set": "standard",
            "icon_key": icon_key,
            "locks_with_plan": True,
            "tag_list": "",
            "sort_order": sort_order,
        }
        for code, label, icon_key, sort_order in SEED_GATES
    ]


_ENTRY_COLUMNS = (
    "id",
    "project_id",
    "check_code",
    "scope",
    "well_project",
    "well_name",
    "activity_type",
    "status",
    "notes",
    "updated_at",
    "updated_by",
)


def _project_readiness_table() -> sa.Table:
    return sa.table(
        "project_readiness",
        sa.column("id", sa.Uuid()),
        sa.column("project_id", sa.Uuid()),
        sa.column("well_project", sa.String(256)),
        sa.column("check_code", sa.String(16)),
        sa.column("status", sa.String(32)),
        sa.column("notes", sa.String(512)),
        sa.column("updated_at", sa.DateTime(timezone=True)),
        sa.column("updated_by", sa.Uuid()),
    )


def _entries_table() -> sa.Table:
    return sa.table(
        "readiness_entries",
        sa.column("id", sa.Uuid()),
        sa.column("project_id", sa.Uuid()),
        sa.column("check_code", sa.String(16)),
        sa.column("scope", sa.String(8)),
        sa.column("well_project", sa.String(256)),
        sa.column("well_name", sa.String(256)),
        sa.column("activity_type", sa.String(256)),
        sa.column("status", sa.String(32)),
        sa.column("notes", sa.String(512)),
        sa.column("updated_at", sa.DateTime(timezone=True)),
        sa.column("updated_by", sa.Uuid()),
    )


def upgrade() -> None:
    op.create_table(
        "readiness_teams",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("code", sa.String(32), nullable=False),
        sa.Column("name", sa.String(64), nullable=False),
        sa.Column("editor_source", sa.String(16), nullable=False),
        sa.Column("icon_key", sa.String(32), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code", name="uq_readiness_teams_code"),
    )
    teams = sa.table(
        "readiness_teams",
        sa.column("id", sa.Uuid()),
        sa.column("code", sa.String(32)),
        sa.column("name", sa.String(64)),
        sa.column("editor_source", sa.String(16)),
        sa.column("icon_key", sa.String(32)),
        sa.column("sort_order", sa.Integer()),
        sa.column("is_active", sa.Boolean()),
    )
    op.execute(teams.insert().values([{"id": uuid.uuid4(), **t} for t in SEED_TEAMS]))

    op.create_table(
        "readiness_checks",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("code", sa.String(16), nullable=False),
        sa.Column("label", sa.String(64), nullable=False),
        sa.Column("team_code", sa.String(32), nullable=False),
        sa.Column("applies_project", sa.Boolean(), nullable=False),
        sa.Column("applies_well", sa.Boolean(), nullable=False),
        sa.Column("status_set", sa.String(16), nullable=False),
        sa.Column("icon_key", sa.String(32), nullable=False),
        sa.Column("locks_with_plan", sa.Boolean(), nullable=False),
        sa.Column("tag_list", sa.String(32), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("retired_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["team_code"], ["readiness_teams.code"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code", name="uq_readiness_checks_code"),
    )
    checks = sa.table(
        "readiness_checks",
        sa.column("id", sa.Uuid()),
        sa.column("code", sa.String(16)),
        sa.column("label", sa.String(64)),
        sa.column("team_code", sa.String(32)),
        sa.column("applies_project", sa.Boolean()),
        sa.column("applies_well", sa.Boolean()),
        sa.column("status_set", sa.String(16)),
        sa.column("icon_key", sa.String(32)),
        sa.column("locks_with_plan", sa.Boolean()),
        sa.column("tag_list", sa.String(32)),
        sa.column("sort_order", sa.Integer()),
    )
    op.execute(checks.insert().values([{"id": uuid.uuid4(), **c} for c in seed_checks()]))

    op.create_table(
        "readiness_entries",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("check_code", sa.String(16), nullable=False),
        sa.Column("scope", sa.String(8), nullable=False),
        sa.Column("well_project", sa.String(256), nullable=False),
        sa.Column("well_name", sa.String(256), nullable=False),
        sa.Column("activity_type", sa.String(256), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("notes", sa.String(512), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("updated_by", sa.Uuid(), nullable=True),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["check_code"], ["readiness_checks.code"]),
        sa.ForeignKeyConstraint(["updated_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        # VARCHAR key ≈ 16 + 16 + 8 + 3×256 bytes = 808 B — inside SQL Server's
        # 1700-byte nonclustered index key limit.
        sa.UniqueConstraint(
            "project_id",
            "check_code",
            "scope",
            "well_project",
            "well_name",
            "activity_type",
            name="uq_readiness_entry",
        ),
    )
    op.create_index(
        "ix_readiness_entries_project_id", "readiness_entries", ["project_id"]
    )

    old = _project_readiness_table()
    op.execute(
        _entries_table()
        .insert()
        .from_select(
            list(_ENTRY_COLUMNS),
            sa.select(
                old.c.id,
                old.c.project_id,
                old.c.check_code,
                sa.literal("project"),
                old.c.well_project,
                sa.literal(""),
                sa.literal(""),
                old.c.status,
                old.c.notes,
                old.c.updated_at,
                old.c.updated_by,
            ).where(old.c.check_code.in_([code for code, *_ in SEED_GATES])),
        )
    )
    op.drop_index("ix_project_readiness_project_id", table_name="project_readiness")
    op.drop_table("project_readiness")

    op.add_column("revisions", sa.Column("catalog_json", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("revisions", "catalog_json")

    op.create_table(
        "project_readiness",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("well_project", sa.String(256), nullable=False),
        sa.Column("check_code", sa.String(16), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="On Track"),
        sa.Column("notes", sa.String(512), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("updated_by", sa.Uuid(), nullable=True),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["updated_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "project_id", "well_project", "check_code", name="uq_project_readiness_gate"
        ),
    )
    op.create_index(
        "ix_project_readiness_project_id", "project_readiness", ["project_id"]
    )
    # Only field-project entries fit the old table; well-scope entries (Phase 3+)
    # have nowhere to go and are dropped with readiness_entries.
    entries = _entries_table()
    op.execute(
        _project_readiness_table()
        .insert()
        .from_select(
            [
                "id",
                "project_id",
                "well_project",
                "check_code",
                "status",
                "notes",
                "updated_at",
                "updated_by",
            ],
            sa.select(
                entries.c.id,
                entries.c.project_id,
                entries.c.well_project,
                entries.c.check_code,
                entries.c.status,
                entries.c.notes,
                entries.c.updated_at,
                entries.c.updated_by,
            ).where(entries.c.scope == "project"),
        )
    )

    op.drop_index("ix_readiness_entries_project_id", table_name="readiness_entries")
    op.drop_table("readiness_entries")
    op.drop_table("readiness_checks")
    op.drop_table("readiness_teams")
