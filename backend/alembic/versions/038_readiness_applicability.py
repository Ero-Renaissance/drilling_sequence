"""Checks that apply (phase 6 of docs/readiness-framework-spec.md, §3.8 and §4.4).

- ``readiness_applicability``: a team's choice that a check does or doesn't apply
  to one target (a field project or a well). Only for checks that DON'T lock with
  the plan: the Project gates keep N/A (decision 31) and never get a row.
- Those checks' stored N/A values meant "doesn't apply", so they become unticks
  (``applies = false`` at the same key) and the N/A entries go. A well with its
  own status under a field project that was N/A applied (own entries won), so it
  keeps applying as its own choice (``applies = true``). The Project gates' N/A
  entries are left alone.
- One ``readiness_applicability_migrated`` audit event per campaign converted,
  with the count and any notes the deleted entries carried.
- Withdrawn checks — a history-only status set (``availability``) or a tag list,
  i.e. ``NEQ`` — still active are retired, each with a ``readiness_check_retired``
  event. Their entries, tags and history stay.

Bind-free: every data step is ``op.execute`` of a SQLAlchemy Core statement,
because tests/test_migration_model_parity.py replays upgrade() against a fake bind
(op.execute is a no-op there). Booleans are ``sa.true()`` / ``sa.false()``: raw
true/false isn't T-SQL, and ``.is_(...)`` renders ``IS 0``. Ids are generated in
SQL — ``newid()`` on SQL Server, ``gen_random_uuid()`` elsewhere (PostgreSQL 13+).
Literals are written out here, never imported from app code, so a later model
change can't rewrite what this migration did. Audit details are ASCII (VARCHAR
on SQL Server).

The SQLite suite never runs migrations; tests/test_migration_038_mssql.py runs
this one on SQL Server (CI), and tests/test_migration_038_sqlite.py replays its
steps on SQLite.

Downgrade is lossy: a status kept under an untick becomes N/A again.

Revision ID: 038
Revises: 037
Create Date: 2026-10-23
"""

import logging

import sqlalchemy as sa

from alembic import op

revision = "038"
down_revision = "037"
branch_labels = None
depends_on = None

logger = logging.getLogger("alembic.runtime.migration")

NA = "N/A"
PROJECTS_TEAM = "projects"
# Status sets kept only for history (phase 6). A check on one, or with a tag
# list, is withdrawn.
HISTORY_ONLY_SETS = ("availability",)
# What an unset entry of each status set reads (downgrade step 1).
SET_DEFAULTS = {"standard": "On Track", "availability": "Pending"}

ENTITY_READINESS = "readiness"
ENTITY_READINESS_CATALOG = "readiness_catalog"
MIGRATED = "readiness_applicability_migrated"
CHECK_RETIRED = "readiness_check_retired"
CHECK_RESTORED = "readiness_check_restored"
# Ends the detail of this migration's own retirements, so the downgrade can tell
# them from an admin's.
MARK = "migration 038"
DETAIL_MAX = 512

# The target key, shared with readiness_entries (uq_readiness_entry).
_KEY = ("project_id", "check_code", "scope", "well_project", "well_name", "activity_type")
_ROW_COLUMNS = ["id", *_KEY, "applies", "updated_at", "updated_by"]
_ENTRY_COLUMNS = ["id", *_KEY, "status", "updated_at", "updated_by"]


def _key_columns() -> list[sa.ColumnClause]:
    return [
        sa.column("project_id", sa.Uuid()),
        sa.column("check_code", sa.String(16)),
        sa.column("scope", sa.String(8)),
        sa.column("well_project", sa.String(256)),
        sa.column("well_name", sa.String(256)),
        sa.column("activity_type", sa.String(256)),
    ]


def _entries() -> sa.TableClause:
    return sa.table(
        "readiness_entries",
        sa.column("id", sa.Uuid()),
        *_key_columns(),
        sa.column("status", sa.String(32)),
        sa.column("notes", sa.String(512)),
        sa.column("updated_at", sa.DateTime(timezone=True)),
        sa.column("updated_by", sa.Uuid()),
    )


def _applicability() -> sa.TableClause:
    return sa.table(
        "readiness_applicability",
        sa.column("id", sa.Uuid()),
        *_key_columns(),
        sa.column("applies", sa.Boolean()),
        sa.column("updated_at", sa.DateTime(timezone=True)),
        sa.column("updated_by", sa.Uuid()),
    )


def _checks() -> sa.TableClause:
    return sa.table(
        "readiness_checks",
        sa.column("id", sa.Uuid()),
        sa.column("code", sa.String(16)),
        sa.column("label", sa.String(64)),
        sa.column("team_code", sa.String(32)),
        sa.column("status_set", sa.String(16)),
        sa.column("tag_list", sa.String(32)),
        sa.column("locks_with_plan", sa.Boolean()),
        sa.column("retired_at", sa.DateTime(timezone=True)),
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


def _new_id() -> sa.FunctionElement:
    """A UUID generated in SQL. The parity test's fake bind reports sqlite, so it
    takes the else branch."""
    if op.get_bind().dialect.name == "mssql":
        return sa.func.newid()
    return sa.func.gen_random_uuid()


def _same_key(a: sa.FromClause, b: sa.FromClause) -> sa.ColumnElement[bool]:
    return sa.and_(*[a.c[k] == b.c[k] for k in _KEY])


def _same_field_project(project: sa.FromClause, well: sa.FromClause) -> sa.ColumnElement[bool]:
    """``project`` is the field-project-level value the well ``well`` sits under."""
    return sa.and_(
        project.c.project_id == well.c.project_id,
        project.c.check_code == well.c.check_code,
        project.c.scope == "project",
        project.c.well_project == well.c.well_project,
    )


def _team_check_codes(checks: sa.TableClause) -> sa.Select:
    """Checks that don't lock with the plan — every team's but the Project gates'
    (decision 23), retired ones included."""
    return sa.select(checks.c.code).where(checks.c.locks_with_plan == sa.false())


def upgrade() -> None:
    # 1. The table. Its key is uq_readiness_entry's six columns, which already
    #    fit SQL Server's 1700-byte index key limit (~808 B of VARCHAR).
    op.create_table(
        "readiness_applicability",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("check_code", sa.String(16), nullable=False),
        sa.Column("scope", sa.String(8), nullable=False),
        sa.Column("well_project", sa.String(256), nullable=False),
        sa.Column("well_name", sa.String(256), nullable=False),
        sa.Column("activity_type", sa.String(256), nullable=False),
        sa.Column("applies", sa.Boolean(), nullable=False),
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
        sa.UniqueConstraint(*_KEY, name="uq_readiness_applicability"),
    )
    op.create_index(
        "ix_readiness_applicability_project_id", "readiness_applicability", ["project_id"]
    )

    entries = _entries()
    rows = _applicability()
    checks = _checks()
    audit = _audit()
    new_id = _new_id()
    # The entries this migration converts: every N/A of a check that doesn't lock
    # with the plan, retired checks included. The Project gates' N/A stays.
    converted = sa.and_(
        entries.c.status == NA, entries.c.check_code.in_(_team_check_codes(checks))
    )

    # 2. Each becomes "doesn't apply" at the same key, keeping who set it and when.
    #    A well's own N/A under a field project that is also N/A becomes a well row
    #    too, and stays: re-ticking the project leaves that well unticked, as its
    #    own N/A does today.
    op.execute(
        rows.insert().from_select(
            _ROW_COLUMNS,
            sa.select(
                new_id,
                *[entries.c[k] for k in _KEY],
                sa.false(),
                entries.c.updated_at,
                entries.c.updated_by,
            ).where(converted),
        )
    )

    # 3. A well with its own non-N/A status under a field project whose entry is
    #    N/A applies today (own entries win), so it keeps applying as its own
    #    choice once its project is unticked.
    project_na = entries.alias("project_na")
    op.execute(
        rows.insert().from_select(
            _ROW_COLUMNS,
            sa.select(
                new_id,
                *[entries.c[k] for k in _KEY],
                sa.true(),
                entries.c.updated_at,
                entries.c.updated_by,
            ).where(
                entries.c.scope == "well",
                entries.c.status != NA,
                entries.c.check_code.in_(_team_check_codes(checks)),
                sa.exists().where(
                    _same_field_project(project_na, entries), project_na.c.status == NA
                ),
            ),
        )
    )

    # 4. One audit event per campaign that had any, in that campaign's feed: the
    #    count converted, plus any notes the converted entries carried (they are
    #    deleted in step 5; no screen sets readiness notes, so none are expected).
    target = sa.case(
        (
            entries.c.scope == "well",
            entries.c.well_name
            + sa.literal(" (")
            + entries.c.well_project
            + sa.literal(", ")
            + entries.c.activity_type
            + sa.literal(")"),
        ),
        else_=entries.c.well_project,
    )
    # NULL when the entry has no note (string concatenation with NULL is NULL on
    # every backend), and string_agg skips NULLs. VARCHAR(max) on SQL Server, so
    # the aggregate can't overflow STRING_AGG's 8000-byte limit for VARCHAR(n).
    note = sa.cast(
        entries.c.check_code
        + sa.literal(" for ")
        + target
        + sa.literal(": ")
        + entries.c.notes,
        sa.String(),
    )
    detail = (
        sa.literal("Converted ")
        + sa.cast(sa.func.count(), sa.String())
        + sa.literal(" N/A value(s) of checks that don't lock with the plan to 'does not apply'")
        + sa.func.coalesce(
            sa.literal("; notes: ") + sa.func.aggregate_strings(note, " | "), sa.literal("")
        )
        + sa.literal(" - " + MARK)
    )
    op.execute(
        audit.insert().from_select(
            ["id", "project_id", "entity_type", "entity_id", "field", "new_value"],
            sa.select(
                new_id,
                entries.c.project_id,
                sa.literal(ENTITY_READINESS),
                entries.c.project_id,
                sa.literal(MIGRATED),
                sa.func.substring(detail, 1, DETAIL_MAX),
            )
            .where(converted)
            .group_by(entries.c.project_id),
        )
    )
    # A governed check outside the Projects team (admins could create one between
    # 2026-10-13 and -16, before decision 23) keeps N/A and gets no tick list.
    # None is expected. This read only feeds the log, so it is skipped where the
    # bind can't execute (the parity test's fake bind).
    bind = op.get_bind()
    if hasattr(bind, "execute"):
        governed_elsewhere = bind.execute(
            sa.select(checks.c.code, checks.c.team_code)
            .where(checks.c.locks_with_plan == sa.true(), checks.c.team_code != PROJECTS_TEAM)
            .order_by(checks.c.code)
        ).all()
        for code, team_code in governed_elsewhere:
            logger.warning(
                "migration 038: check %s of team %s locks with the plan outside the "
                "Projects team; it keeps N/A and gets no tick list",
                code,
                team_code,
            )

    # 5. The converted N/A entries go — only now, as steps 2-4 read them.
    op.execute(entries.delete().where(converted))

    # 6. Retire the withdrawn checks still active (NEQ; any other check on a
    #    history-only set or with a tag list), audited as the admin endpoint does.
    #    An already-retired check is untouched, so it gets no second event.
    active_withdrawn = sa.and_(
        checks.c.retired_at.is_(None),
        sa.or_(checks.c.status_set.in_(HISTORY_ONLY_SETS), checks.c.tag_list != ""),
    )
    op.execute(
        audit.insert().from_select(
            ["id", "entity_type", "entity_id", "field", "new_value"],
            sa.select(
                new_id,
                sa.literal(ENTITY_READINESS_CATALOG),
                checks.c.id,
                sa.literal(CHECK_RETIRED),
                sa.literal("Retired readiness check ")
                + checks.c.code
                + sa.literal(" (")
                + checks.c.label
                + sa.literal(") - " + MARK),
            ).where(active_withdrawn),
        )
    )
    op.execute(checks.update().where(active_withdrawn).values(retired_at=sa.func.now()))


def downgrade() -> None:
    entries = _entries()
    rows = _applicability()
    checks = _checks()
    audit = _audit()
    new_id = _new_id()
    own_entry = entries.alias("own_entry")
    project_untick = rows.alias("project_untick")
    has_entry = sa.exists().where(_same_key(own_entry, rows))

    # 1. A well ticked under an unticked field project reads its status set's
    #    default. Once the project's entry is N/A again the well would inherit
    #    N/A, so it gets that default as its own entry. A ticked well under a
    #    field project that applies needs nothing.
    op.execute(
        entries.insert().from_select(
            _ENTRY_COLUMNS,
            sa.select(
                new_id,
                *[rows.c[k] for k in _KEY],
                sa.case(SET_DEFAULTS, value=checks.c.status_set, else_=SET_DEFAULTS["standard"]),
                rows.c.updated_at,
                rows.c.updated_by,
            )
            .select_from(rows.join(checks, checks.c.code == rows.c.check_code))
            .where(
                rows.c.scope == "well",
                rows.c.applies == sa.true(),
                ~has_entry,
                sa.exists().where(
                    _same_field_project(project_untick, rows),
                    project_untick.c.applies == sa.false(),
                ),
            ),
        )
    )

    # 2. Every untick becomes N/A at its key: the entry there (its notes kept), or
    #    a new one carrying the untick's time and author.
    untick = rows.alias("untick")
    op.execute(
        entries.update()
        .where(sa.exists().where(untick.c.applies == sa.false(), _same_key(untick, entries)))
        .values(status=NA)
    )
    op.execute(
        entries.insert().from_select(
            _ENTRY_COLUMNS,
            sa.select(
                new_id,
                *[rows.c[k] for k in _KEY],
                sa.literal(NA),
                rows.c.updated_at,
                rows.c.updated_by,
            ).where(rows.c.applies == sa.false(), ~has_entry),
        )
    )

    # 3. A field-project untick reaches every well that follows it, own status or
    #    not, so those wells' own entries become N/A too. Wells that chose to
    #    apply keep theirs.
    well_tick = rows.alias("well_tick")
    op.execute(
        entries.update()
        .where(
            entries.c.scope == "well",
            sa.exists().where(
                _same_field_project(project_untick, entries),
                project_untick.c.applies == sa.false(),
            ),
            ~sa.exists().where(well_tick.c.applies == sa.true(), _same_key(well_tick, entries)),
        )
        .values(status=NA)
    )

    # 4. Un-retire a check only while this migration's retirement (no user, detail
    #    ending MARK) is still its latest retire/restore event; one an admin
    #    retired themselves stays retired. Un-retired first, then audited: after
    #    the update the same test picks out exactly the checks it un-retired.
    retirement = audit.alias("retirement")
    later = audit.alias("later_event")
    retired_by_038 = sa.exists().where(
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
    op.execute(
        checks.update()
        .where(checks.c.retired_at.is_not(None), retired_by_038)
        .values(retired_at=sa.null())
    )
    op.execute(
        audit.insert().from_select(
            ["id", "entity_type", "entity_id", "field", "new_value"],
            sa.select(
                new_id,
                sa.literal(ENTITY_READINESS_CATALOG),
                checks.c.id,
                sa.literal(CHECK_RESTORED),
                sa.literal("Restored readiness check ")
                + checks.c.code
                + sa.literal(" (")
                + checks.c.label
                + sa.literal(") - " + MARK + " downgrade"),
            ).where(checks.c.retired_at.is_(None), retired_by_038),
        )
    )

    # 5.
    op.drop_index(
        "ix_readiness_applicability_project_id", table_name="readiness_applicability"
    )
    op.drop_table("readiness_applicability")
