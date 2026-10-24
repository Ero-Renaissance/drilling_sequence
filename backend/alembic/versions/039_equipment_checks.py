"""Equipment checks (phase 7 of docs/readiness-framework-spec.md, §3.9 and §4.5).

- ``readiness_checks`` gains two columns:
  - ``category`` (String(64), NOT NULL, default "") — an admin-editable label
    grouping checks within a team; "" = none. Always "" on a check that locks
    with the plan (the Project gates keep their seven icons).
  - ``applies_by_default`` (Boolean, NOT NULL, default true) — false = "starts
    unticked": with no applicability row the check is NOT SELECTED and carries
    nothing. Fixed at creation; always true on a check that locks with the plan.
  Every existing check gets the defaults: no category, starts ticked (phase 6).
- Seeds the 21 equipment types of §3.5 as ordinary Logistics checks (decision
  35): plain codes (decision 38), enabled at both levels, the standard status
  set, operational, starting unticked (decision 36), each with its §3.4 category
  and icon, sort orders 100 and up so they follow the six core checks. A code is
  inserted only where it is absent (036's convention), with a Python uuid literal
  as its id, and gets a ``readiness_check_created`` event selected by that id —
  so a code that already existed gets no event.
- Upgrading again after this migration's own downgrade (§4.5): every check still
  retired whose ``readiness_check_created`` detail says it starts unticked starts
  unticked again; of those, one whose latest retire/restore event is this
  migration's downgrade retirement is restored (audited); the 21 seeded checks
  get their category back. Categories an admin set are lost (the downgrade is
  lossy), and a check an admin retired stays retired.

Bind-free, like 038: every data step is ``op.execute`` of a SQLAlchemy Core
statement, because tests/test_migration_model_parity.py replays upgrade() against
a fake bind. Booleans are ``sa.true()`` / ``sa.false()`` (raw true/false isn't
T-SQL; ``.is_(...)`` renders ``IS 0``). Audit ids are generated in SQL —
``newid()`` on SQL Server, ``gen_random_uuid()`` elsewhere. Literals are written
out here, never imported from app code, so a later model change can't rewrite
what this migration did. Labels and audit details are ASCII (VARCHAR on SQL
Server).

Downgrade: pre-039 code would read a check that starts unticked as applying
everywhere, so none may stay active — every active one (the 21 seeded and any an
admin created) is retired, audited, before both columns are dropped. Their
entries and applicability rows stay, as for any retired check.

The SQLite suite never runs migrations; tests/test_migration_039_sqlite.py
replays this one on SQLite and tests/test_migration_039_mssql.py runs it on SQL
Server (CI).

Revision ID: 039
Revises: 038
Create Date: 2026-10-24
"""

import uuid
from typing import Any

import sqlalchemy as sa

from alembic import op

revision = "039"
down_revision = "038"
branch_labels = None
depends_on = None

LOGISTICS_TEAM = "logistics"
ENTITY_READINESS_CATALOG = "readiness_catalog"
CHECK_CREATED = "readiness_check_created"
CHECK_RETIRED = "readiness_check_retired"
CHECK_RESTORED = "readiness_check_restored"
# Ends the detail of this migration's own events (no user), so a later upgrade
# can tell its downgrade retirements — and its seed — from an admin's.
MARK = "migration 039"
# How a readiness_check_created detail ends for a check that starts unticked —
# the admin endpoint's, or this migration's seed (then followed by " - " + MARK).
# After the label (always followed by fixed text) the only free text is the
# category, and the admin API refuses a category containing ';'
# (app/schemas/readiness.py), so no detail ends this way unless the check
# started unticked.
STARTS_UNTICKED = "; starts unticked"

# Each equipment category's icon (spec §3.4) — every type in a category shares it.
CATEGORY_ICONS = {
    "Aviation": "helicopter",
    "Vessels": "anchor",
    "Barges": "container",
    "Land transport": "bus",
    "Lifting": "construction",
    "Permits": "radiation",
}

# (code, label, category) — the 21 equipment types in §3.4's order, with the
# labels of the seed list (§3.5) as migration 036 seeded them.
EQUIPMENT_CHECKS = (
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

# After the six core Logistics checks (10-70), with room between the types.
FIRST_SORT_ORDER = 100
SORT_STEP = 10


def seed_checks() -> list[dict[str, Any]]:
    """The 21 seeded check definitions (no ids) — also what tests seed with the
    ORM on the SQLite schema (tests/readiness_seed.py)."""
    return [
        {
            "code": code,
            "label": label,
            "team_code": LOGISTICS_TEAM,
            "applies_project": True,
            "applies_well": True,
            "status_set": "standard",
            "icon_key": CATEGORY_ICONS[category],
            "locks_with_plan": False,
            "tag_list": "",
            "sort_order": FIRST_SORT_ORDER + i * SORT_STEP,
            "category": category,
            "applies_by_default": False,
        }
        for i, (code, label, category) in enumerate(EQUIPMENT_CHECKS)
    ]


def created_detail(check: dict[str, Any]) -> str:
    """The seed's ``readiness_check_created`` detail: the admin endpoint's, then
    this migration's mark."""
    return (
        f"Created readiness check {check['code']} ({check['label']}) for team "
        f"{check['team_code']}; scope project+well; status set {check['status_set']}; "
        f"stays live; category {check['category']}{STARTS_UNTICKED} - {MARK}"
    )


def _checks() -> sa.TableClause:
    return sa.table(
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
        sa.column("retired_at", sa.DateTime(timezone=True)),
        sa.column("category", sa.String(64)),
        sa.column("applies_by_default", sa.Boolean()),
    )


def _audit() -> sa.TableClause:
    return sa.table(
        "audit_logs",
        sa.column("id", sa.Uuid()),
        sa.column("project_id", sa.Uuid()),
        sa.column("user_id", sa.Uuid()),
        sa.column("entity_type", sa.String(64)),
        sa.column("entity_id", sa.Uuid()),
        sa.column("field", sa.String(128)),
        sa.column("new_value", sa.Text()),
        sa.column("timestamp", sa.DateTime(timezone=True)),
    )


_AUDIT_COLUMNS = ["id", "entity_type", "entity_id", "field", "new_value"]


def _new_id() -> sa.FunctionElement:
    """A UUID generated in SQL. The parity test's fake bind reports sqlite, so it
    takes the else branch."""
    if op.get_bind().dialect.name == "mssql":
        return sa.func.newid()
    return sa.func.gen_random_uuid()


def _value(table: sa.TableClause, column: str, value: Any) -> sa.ColumnElement[Any]:
    """A literal for an INSERT ... SELECT list: booleans as sa.true()/sa.false()
    (1/0 on SQL Server), everything else a bound literal of the column's type."""
    if isinstance(value, bool):
        return sa.true() if value else sa.false()
    return sa.literal(value, type_=table.c[column].type)


def _check_named(checks: sa.TableClause, verb: str, suffix: str) -> sa.ColumnElement[str]:
    """ "<verb> readiness check CODE (Label)<suffix>" — the admin endpoint's detail."""
    return (
        sa.literal(f"{verb} readiness check ")
        + checks.c.code
        + sa.literal(" (")
        + checks.c.label
        + sa.literal(")" + suffix)
    )


def upgrade() -> None:
    # 1. The two columns. Server defaults fill every existing check: no
    #    category, starts ticked — what phase 6 reads.
    op.add_column(
        "readiness_checks",
        sa.Column("category", sa.String(64), nullable=False, server_default=""),
    )
    op.add_column(
        "readiness_checks",
        sa.Column("applies_by_default", sa.Boolean(), nullable=False, server_default=sa.true()),
    )

    checks = _checks()
    audit = _audit()
    new_id = _new_id()

    # 2. The 21 equipment checks, each only where its code is absent, then its
    #    created event selected by the literal id — so a code that already
    #    existed (an admin's, or this seed's on a later upgrade) gets none.
    for row in seed_checks():
        check_id = uuid.uuid4()
        values = {"id": check_id, **row}
        absent = ~sa.exists().where(checks.c.code == row["code"])
        op.execute(
            checks.insert().from_select(
                list(values),
                sa.select(*[_value(checks, k, v) for k, v in values.items()]).where(absent),
            )
        )
        op.execute(
            audit.insert().from_select(
                _AUDIT_COLUMNS,
                sa.select(
                    new_id,
                    sa.literal(ENTITY_READINESS_CATALOG),
                    checks.c.id,
                    sa.literal(CHECK_CREATED),
                    sa.literal(created_detail(row)),
                ).where(checks.c.id == check_id),
            )
        )

    # 3. Upgrading again after this migration's downgrade, which dropped the
    #    columns. A check still retired whose created event says it starts
    #    unticked starts unticked again (the column came back as true).
    created = audit.alias("created")
    created_unticked = sa.exists().where(
        created.c.entity_type == ENTITY_READINESS_CATALOG,
        created.c.entity_id == checks.c.id,
        created.c.field == CHECK_CREATED,
        sa.or_(
            created.c.new_value.like("%" + STARTS_UNTICKED),
            created.c.new_value.like("%" + STARTS_UNTICKED + " - " + MARK),
        ),
    )
    op.execute(
        checks.update()
        .where(checks.c.retired_at.is_not(None), created_unticked)
        .values(applies_by_default=sa.false())
    )

    # 4. Of those, restore the ones the downgrade retired: this migration's
    #    retirement (no user, detail ending MARK) is still the check's latest
    #    retire/restore event. One an admin retired stays retired. Restored
    #    first, then audited (038's order): after the update the same test picks
    #    out exactly the checks it restored, even where the two events share a
    #    timestamp.
    retirement = audit.alias("retirement")
    later = audit.alias("later_event")
    retired_by_039 = sa.exists().where(
        retirement.c.entity_type == ENTITY_READINESS_CATALOG,
        retirement.c.entity_id == checks.c.id,
        retirement.c.field == CHECK_RETIRED,
        retirement.c.user_id.is_(None),
        retirement.c.new_value.like("%" + MARK),
        ~sa.exists().where(
            later.c.entity_type == ENTITY_READINESS_CATALOG,
            later.c.entity_id == retirement.c.entity_id,
            later.c.field.in_([CHECK_RETIRED, CHECK_RESTORED]),
            later.c.timestamp > retirement.c.timestamp,
        ),
    )
    starts_unticked = checks.c.applies_by_default == sa.false()
    op.execute(
        checks.update()
        .where(checks.c.retired_at.is_not(None), starts_unticked, retired_by_039)
        .values(retired_at=sa.null())
    )
    op.execute(
        audit.insert().from_select(
            _AUDIT_COLUMNS,
            sa.select(
                new_id,
                sa.literal(ENTITY_READINESS_CATALOG),
                checks.c.id,
                sa.literal(CHECK_RESTORED),
                _check_named(checks, "Restored", f" - {MARK} upgrade"),
            ).where(checks.c.retired_at.is_(None), starts_unticked, retired_by_039),
        )
    )

    # 5. The seeded checks — found by this migration's own created events — get
    #    their category back, retired or not. (A no-op on the first upgrade.)
    seeded = audit.alias("seeded")
    created_by_039 = sa.exists().where(
        seeded.c.entity_type == ENTITY_READINESS_CATALOG,
        seeded.c.entity_id == checks.c.id,
        seeded.c.field == CHECK_CREATED,
        seeded.c.user_id.is_(None),
        seeded.c.new_value.like("%" + STARTS_UNTICKED + " - " + MARK),
    )
    categories = {code: category for code, _label, category in EQUIPMENT_CHECKS}
    op.execute(
        checks.update()
        .where(checks.c.code.in_(list(categories)), created_by_039)
        .values(category=sa.case(categories, value=checks.c.code, else_=checks.c.category))
    )


def _drop_column(table: str, column: str) -> None:
    """Portable DROP COLUMN (MSSQL requires dropping the DEFAULT constraint first —
    see migration 008 for the full rationale). Identifiers are fixed constants.
    Copied from migration 022: migrations never import each other."""
    if op.get_bind().dialect.name == "mssql":
        op.execute(
            f"DECLARE @c sysname; "
            f"SELECT @c = dc.name FROM sys.default_constraints dc "
            f"JOIN sys.columns col ON col.object_id = dc.parent_object_id "
            f"AND col.column_id = dc.parent_column_id "
            f"WHERE dc.parent_object_id = OBJECT_ID(N'{table}') AND col.name = N'{column}'; "
            f"IF @c IS NOT NULL EXEC('ALTER TABLE [{table}] DROP CONSTRAINT [' + @c + ']');"
        )
    op.drop_column(table, column)


def downgrade() -> None:
    checks = _checks()
    audit = _audit()
    new_id = _new_id()

    # 1. Retire every active check that starts unticked — the seeded 21 and any
    #    an admin created — audited as the admin endpoint does, with no user and
    #    a detail ending MARK so upgrading again can restore exactly these.
    #    Audited first, then retired: the same test picks out the same checks.
    active_unticked = sa.and_(
        checks.c.retired_at.is_(None), checks.c.applies_by_default == sa.false()
    )
    op.execute(
        audit.insert().from_select(
            _AUDIT_COLUMNS,
            sa.select(
                new_id,
                sa.literal(ENTITY_READINESS_CATALOG),
                checks.c.id,
                sa.literal(CHECK_RETIRED),
                _check_named(checks, "Retired", f" on downgrade - {MARK}"),
            ).where(active_unticked),
        )
    )
    op.execute(checks.update().where(active_unticked).values(retired_at=sa.func.now()))

    # 2. The columns (SQL Server: each default constraint first).
    _drop_column("readiness_checks", "applies_by_default")
    _drop_column("readiness_checks", "category")
