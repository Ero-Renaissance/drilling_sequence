"""Well execution readiness (phase 8, docs/well-execution-readiness-spec.md, Part A).

Data only — no schema change. The seven Project gates become the WELL EXECUTION
READINESS checks:

- every active or retired check that LOCKS WITH THE PLAN (the Projects team's)
  moves to the ``execution`` status set — the standard statuses plus "Not
  started", which is also what an unset check now reads — and is enabled at WELL
  level as well as field-project level: each well follows its field project
  until it is given its own value. No stored status is rewritten: every status a
  gate holds today ("On Track", "Completed", "Behind", "N/A") is in the new set.
- the seven built-in gates are relabelled and reordered as the "Well Execution
  Readiness" sheet has them (codes are immutable, so their values stay attached):
  FDP "Approved FDP/IP", FID "Final Investment Decision", BUD "Budget Supported
  by Partners", FE "Well Proposal", EIA "EIA/Waiver", LOC "Location Readiness";
  LLI keeps "Long Lead Items". (The sheet heads FID and LLI by their codes,
  which every view shows beside the label — a label equal to its code would
  read "FID FID".) Icons are left alone.
- ``WP`` "Well Permits" is added, only where the code is absent (036's
  convention), with a ``readiness_check_created`` event selected by its id — so
  a ``WP`` an admin already created keeps its definition and gets no event.
  (Check before deploying: if ``WP`` exists in another team, the Projects team
  gets no Well Permits check until an admin adds one under another code.)
- one ``readiness_check_updated`` catalog event per check changed (no user,
  detail ending "migration 040"), in the admin endpoint's wording.

What changes for existing campaigns: a check nobody has set read "On Track" and
now reads "Not started", so live On-track figures drop that day. Approved and
pending revisions are untouched — they recorded values, not defaults, and render
from their own frozen catalogs.

Bind-free, like 038/039: every step is ``op.execute`` of a SQLAlchemy Core
statement (tests/test_migration_model_parity.py replays upgrade() against a fake
bind). Booleans are ``sa.true()`` / ``sa.false()``; ids are generated in SQL
(``newid()`` on SQL Server, ``gen_random_uuid()`` elsewhere). Literals are
written out here, never imported from app code. Labels and details are ASCII.

Downgrade is lossy: the checks return to the ``standard`` set at field-project
level with their old labels and order; a stored "Not started" becomes "On Track"
(what pre-040 code reads for an unset gate); ``WP`` is retired (audited), never
deleted. Values set on individual wells stay in ``readiness_entries`` but
pre-040 code doesn't read them — upgrading again brings them back.

The SQLite suite never runs migrations; tests/test_migration_040_sqlite.py
replays this one on SQLite and renders every statement for SQL Server and
PostgreSQL.

Revision ID: 040
Revises: 039
Create Date: 2026-11-23
"""

import uuid
from typing import Any

import sqlalchemy as sa

from alembic import op

revision = "040"
down_revision = "039"
branch_labels = None
depends_on = None

PROJECTS_TEAM = "projects"
EXECUTION = "execution"
STANDARD = "standard"
NOT_STARTED = "Not started"
ON_TRACK = "On Track"

ENTITY_READINESS_CATALOG = "readiness_catalog"
CHECK_CREATED = "readiness_check_created"
CHECK_UPDATED = "readiness_check_updated"
CHECK_RETIRED = "readiness_check_retired"
CHECK_RESTORED = "readiness_check_restored"
MARK = "migration 040"

# code -> (new label, new sort order, old label, old sort order). The old values
# are migration 034's seed, restored on downgrade.
GATES: dict[str, tuple[str, int, str, int]] = {
    "FDP": ("Approved FDP/IP", 10, "Field Development Plan", 10),
    "FID": ("Final Investment Decision", 20, "Final Inv. Decision", 50),
    "BUD": ("Budget Supported by Partners", 30, "Budget", 70),
    "FE": ("Well Proposal", 40, "Wells Front End", 40),
    "EIA": ("EIA/Waiver", 50, "Env. Assessment", 60),
    "LLI": ("Long Lead Items", 60, "Long Lead Items", 20),
    "LOC": ("Location Readiness", 70, "Location", 30),
}

WELL_PERMITS: dict[str, Any] = {
    "code": "WP",
    "label": "Well Permits",
    "team_code": PROJECTS_TEAM,
    "applies_project": True,
    "applies_well": True,
    "status_set": EXECUTION,
    "icon_key": "stamp",
    "locks_with_plan": True,
    "tag_list": "",
    "sort_order": 80,
    "category": "",
    "applies_by_default": True,
}


def execution_checks() -> list[dict[str, Any]]:
    """What a migrated database holds for the eight checks (code, label, order,
    scope, status set) — pinned to ``BUILTIN_CHECKS`` by the SQLite test."""
    rows = [
        {
            "code": code,
            "label": label,
            "sort_order": order,
            "applies_project": True,
            "applies_well": True,
            "status_set": EXECUTION,
            "locks_with_plan": True,
        }
        for code, (label, order, _old_label, _old_order) in GATES.items()
    ]
    rows.append({k: WELL_PERMITS[k] for k in rows[0]})
    return rows


def created_detail() -> str:
    """Well Permits' ``readiness_check_created`` detail: the admin endpoint's
    wording, then this migration's mark."""
    w = WELL_PERMITS
    return (
        f"Created readiness check {w['code']} ({w['label']}) for team {w['team_code']}; "
        f"scope project+well; status set {w['status_set']}; locks with the plan - {MARK}"
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


def _entries() -> sa.TableClause:
    return sa.table(
        "readiness_entries",
        sa.column("check_code", sa.String(16)),
        sa.column("status", sa.String(32)),
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


def _updated(checks: sa.TableClause, what: str) -> sa.ColumnElement[str]:
    """ "Updated readiness check CODE: <what> - migration 040"."""
    return sa.literal("Updated readiness check ") + checks.c.code + sa.literal(f": {what} - {MARK}")


def _log(checks: sa.TableClause, field: str, detail: sa.ColumnElement[str], where: Any) -> None:
    audit = _audit()
    op.execute(
        audit.insert().from_select(
            _AUDIT_COLUMNS,
            sa.select(
                _new_id(),
                sa.literal(ENTITY_READINESS_CATALOG),
                checks.c.id,
                sa.literal(field),
                detail,
            ).where(where),
        )
    )


def upgrade() -> None:
    checks = _checks()
    governed = checks.c.locks_with_plan == sa.true()

    # 1. Every check that locks with the plan not yet on the execution set: the
    #    event first, then the change — the same test picks out the same checks.
    to_move = sa.and_(governed, checks.c.status_set != EXECUTION)
    _log(
        checks,
        CHECK_UPDATED,
        _updated(checks, "status set execution (unset reads Not started); enabled at well level"),
        to_move,
    )
    op.execute(
        checks.update().where(to_move).values(status_set=EXECUTION, applies_well=sa.true())
    )

    # 2. The seven built-in gates: the sheet's labels and order. Only the
    #    Projects team's own (a same-coded check elsewhere can't exist — codes
    #    are unique — but the team test keeps the statement honest).
    builtin = sa.and_(checks.c.team_code == PROJECTS_TEAM, checks.c.code.in_(list(GATES)))
    labels = {code: new for code, (new, _o, _ol, _oo) in GATES.items()}
    orders = {code: order for code, (_n, order, _ol, _oo) in GATES.items()}
    relabel = sa.and_(
        builtin,
        sa.or_(
            checks.c.label != sa.case(labels, value=checks.c.code, else_=checks.c.label),
            checks.c.sort_order
            != sa.case(orders, value=checks.c.code, else_=checks.c.sort_order),
        ),
    )
    _log(
        checks,
        CHECK_UPDATED,
        sa.literal("Updated readiness check ")
        + checks.c.code
        + sa.literal(": label ")
        + checks.c.label
        + sa.literal(" -> ")
        + sa.case(labels, value=checks.c.code, else_=checks.c.label)
        + sa.literal(f"; reordered - {MARK}"),
        relabel,
    )
    op.execute(
        checks.update()
        .where(builtin)
        .values(
            label=sa.case(labels, value=checks.c.code, else_=checks.c.label),
            sort_order=sa.case(orders, value=checks.c.code, else_=checks.c.sort_order),
        )
    )

    # 3. Well Permits, only where the code is absent; its created event selected
    #    by the literal id, so an existing WP gets none.
    check_id = uuid.uuid4()
    values = {"id": check_id, **WELL_PERMITS}
    absent = ~sa.exists().where(checks.c.code == WELL_PERMITS["code"])
    op.execute(
        checks.insert().from_select(
            list(values),
            sa.select(*[_value(checks, k, v) for k, v in values.items()]).where(absent),
        )
    )
    _log(checks, CHECK_CREATED, sa.literal(created_detail()), checks.c.id == check_id)

    # 4. Upgrading again after this migration's downgrade retired WP: restore it
    #    (audited) while that retirement is still its latest retire/restore event.
    audit = _audit()
    retirement = audit.alias("retirement")
    later = audit.alias("later_event")
    retired_by_040 = sa.exists().where(
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
    is_wp = sa.and_(
        checks.c.code == WELL_PERMITS["code"], checks.c.team_code == PROJECTS_TEAM
    )
    op.execute(
        checks.update()
        .where(is_wp, checks.c.retired_at.is_not(None), retired_by_040)
        .values(retired_at=sa.null())
    )
    _log(
        checks,
        CHECK_RESTORED,
        sa.literal(
            f"Restored readiness check {WELL_PERMITS['code']} ({WELL_PERMITS['label']})"
            f" - {MARK} upgrade"
        ),
        sa.and_(is_wp, checks.c.retired_at.is_(None), retired_by_040),
    )


def downgrade() -> None:
    checks = _checks()
    entries = _entries()
    governed = checks.c.locks_with_plan == sa.true()

    # 1. "Not started" isn't a standard status: what pre-040 code reads for an
    #    unset gate is On Track. Lossy.
    on_execution = sa.select(checks.c.code).where(governed, checks.c.status_set == EXECUTION)
    op.execute(
        entries.update()
        .where(entries.c.status == NOT_STARTED, entries.c.check_code.in_(on_execution))
        .values(status=ON_TRACK)
    )

    # 2. Retire Well Permits (audited first, then retired) — never deleted.
    is_wp = sa.and_(
        checks.c.code == WELL_PERMITS["code"],
        checks.c.team_code == PROJECTS_TEAM,
        checks.c.retired_at.is_(None),
    )
    _log(
        checks,
        CHECK_RETIRED,
        sa.literal(
            f"Retired readiness check {WELL_PERMITS['code']} ({WELL_PERMITS['label']})"
            f" on downgrade - {MARK}"
        ),
        is_wp,
    )
    op.execute(checks.update().where(is_wp).values(retired_at=sa.func.now()))

    # 3. Back to the standard set at field-project level; the built-in gates get
    #    migration 034's labels and order back.
    to_move = sa.and_(governed, checks.c.status_set == EXECUTION)
    _log(
        checks,
        CHECK_UPDATED,
        _updated(checks, "status set standard; field-project level only (downgrade)"),
        to_move,
    )
    op.execute(
        checks.update().where(to_move).values(status_set=STANDARD, applies_well=sa.false())
    )
    builtin = sa.and_(checks.c.team_code == PROJECTS_TEAM, checks.c.code.in_(list(GATES)))
    old_labels = {code: old for code, (_n, _o, old, _oo) in GATES.items()}
    old_orders = {code: order for code, (_n, _o, _ol, order) in GATES.items()}
    op.execute(
        checks.update()
        .where(builtin)
        .values(
            label=sa.case(old_labels, value=checks.c.code, else_=checks.c.label),
            sort_order=sa.case(old_orders, value=checks.c.code, else_=checks.c.sort_order),
        )
    )
