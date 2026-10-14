"""Logistics readiness + Nominated Equipment tags (Phase 4 of
docs/readiness-framework-spec.md).

- ``readiness_tag_items``: controlled tag lists (admin-managed), seeded with the
  21 nominated-equipment types.
- ``readiness_entry_tags``: tags on a readiness entry (equipment nominated for a
  field project or a well).
- Seeds the Logistics team (grant-edited) and its seven checks with the codes
  confirmed 2026-10-14. Every logistics check applies at project AND well level
  and stays live (doesn't lock with the plan). NEQ uses the "availability" status
  set (code-defined) and carries the equipment tag list.

Seed rows are literal (never imported from app code) and inserted only where the
code doesn't exist yet, so an admin who already created any of them by hand keeps
their definition. Labels are ASCII (columns may be VARCHAR on SQL Server).

Revision ID: 036
Revises: 035
Create Date: 2026-10-14
"""

import uuid

import sqlalchemy as sa

from alembic import op

revision = "036"
down_revision = "035"
branch_labels = None
depends_on = None

LOGISTICS_TEAM = {
    "code": "logistics",
    "name": "Logistics",
    "editor_source": "team_grant",
    "icon_key": "truck",
    "sort_order": 20,
    "is_active": True,
}

# (code, label, status_set, icon_key, tag_list, sort_order)
LOGISTICS_CHECKS = (
    ("L-BUD", "Budget Availability", "standard", "hand-coins", "", 10),
    ("CTR", "Contract Availability", "standard", "file-signature", "", 20),
    ("NEQ", "Nominated Equipment", "availability", "forklift", "equipment", 30),
    ("FFP", "Assurance / FFP Inspection", "standard", "shield-check", "", 40),
    ("CTS", "Community Trust and Support", "standard", "handshake", "", 50),
    ("PO", "Purchase Order", "standard", "receipt", "", 60),
    ("NAV", "Naval Clearance", "standard", "ship", "", 70),
)

# (code, label, category) — the nominated equipment types, in display order.
EQUIPMENT = (
    ("RW", "Rotary Wing Aircraft / Helicopter", "Aviation"),
    ("DSV", "Diving Support Vessel", "Vessels"),
    ("SEV", "Security Escort Vessel", "Vessels"),
    ("AHTS", "Anchor Handling Tug", "Vessels"),
    ("FSIV", "Fast Support Intervention Vessel", "Vessels"),
    ("PSV", "Platform Support Vessel", "Vessels"),
    ("LHT", "Line Handling Tug", "Vessels"),
    ("TB", "Tugboat", "Vessels"),
    ("PC", "Personnel Carrier", "Vessels"),
    ("JUB", "Jack-up Barge", "Barges"),
    ("ENV", "Environmental Barge", "Barges"),
    ("HB", "Houseboat", "Barges"),
    ("CBG", "Crane Barge", "Barges"),
    ("RP", "Ramp Barge", "Barges"),
    ("LBT", "Lowbed Truck", "Land transport"),
    ("FBT", "Flatbed Truck", "Land transport"),
    ("CB", "Coaster Bus", "Land transport"),
    ("ACB", "Armoured Coaster Bus", "Land transport"),
    ("MB", "Minibus", "Land transport"),
    ("CR", "Crane", "Lifting"),
    ("NNRA", "Radioactive Source Permit", "Permits"),
)


def _insert_if_absent(table: sa.Table, row: dict, *match: str) -> None:
    """INSERT ... SELECT <literals> WHERE NOT EXISTS (same key) — valid on
    PostgreSQL, SQL Server and SQLite, and needs no bind (the migration/model
    parity test replays upgrade() without a database)."""
    exists = sa.exists().where(*[table.c[c] == row[c] for c in match])
    op.execute(
        table.insert().from_select(
            list(row),
            sa.select(*[sa.literal(v, type_=table.c[k].type) for k, v in row.items()]).where(
                ~exists
            ),
        )
    )


def upgrade() -> None:
    op.create_table(
        "readiness_tag_items",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("tag_list", sa.String(32), nullable=False),
        sa.Column("code", sa.String(16), nullable=False),
        sa.Column("label", sa.String(64), nullable=False),
        sa.Column("category", sa.String(64), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("retired_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tag_list", "code", name="uq_readiness_tag_item"),
    )
    op.create_table(
        "readiness_entry_tags",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("entry_id", sa.Uuid(), nullable=False),
        sa.Column("item_code", sa.String(16), nullable=False),
        sa.ForeignKeyConstraint(["entry_id"], ["readiness_entries.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("entry_id", "item_code", name="uq_readiness_entry_tag"),
    )
    op.create_index(
        "ix_readiness_entry_tags_entry_id", "readiness_entry_tags", ["entry_id"]
    )

    items = sa.table(
        "readiness_tag_items",
        sa.column("id", sa.Uuid()),
        sa.column("tag_list", sa.String(32)),
        sa.column("code", sa.String(16)),
        sa.column("label", sa.String(64)),
        sa.column("category", sa.String(64)),
        sa.column("sort_order", sa.Integer()),
    )
    for i, (code, label, category) in enumerate(EQUIPMENT):
        _insert_if_absent(
            items,
            {
                "id": uuid.uuid4(),
                "tag_list": "equipment",
                "code": code,
                "label": label,
                "category": category,
                "sort_order": (i + 1) * 10,
            },
            "tag_list",
            "code",
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
    _insert_if_absent(teams, {"id": uuid.uuid4(), **LOGISTICS_TEAM}, "code")

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
    for code, label, status_set, icon_key, tag_list, sort_order in LOGISTICS_CHECKS:
        _insert_if_absent(
            checks,
            {
                "id": uuid.uuid4(),
                "code": code,
                "label": label,
                "team_code": "logistics",
                "applies_project": True,
                "applies_well": True,
                "status_set": status_set,
                "icon_key": icon_key,
                "locks_with_plan": False,
                "tag_list": tag_list,
                "sort_order": sort_order,
            },
            "code",
        )


def downgrade() -> None:
    # Values entered against the seeded logistics checks would block deleting the
    # checks (FK from readiness_entries), so the catalog rows stay. But pre-036
    # code doesn't know the "availability" status set, so any check using it is
    # retired — retired checks are never read or written.
    checks = sa.table(
        "readiness_checks",
        sa.column("status_set", sa.String(16)),
        sa.column("retired_at", sa.DateTime(timezone=True)),
    )
    op.execute(
        checks.update()
        .where(checks.c.status_set == "availability", checks.c.retired_at.is_(None))
        .values(retired_at=sa.func.now())
    )
    op.drop_index("ix_readiness_entry_tags_entry_id", table_name="readiness_entry_tags")
    op.drop_table("readiness_entry_tags")
    op.drop_table("readiness_tag_items")
