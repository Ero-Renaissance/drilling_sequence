"""Migration 040 (docs/well-execution-readiness-spec.md, Part A) in the everyday
suite.

The suite builds its schema with ``create_all`` and never runs a migration, so
these tests drive 040 directly:

- its upgrade, downgrade and upgrade again, through Alembic's ``Operations`` on
  an in-memory SQLite database put back to what 039 left (the original seven
  gates: ``standard`` set, field-project level, 034's labels and order);
- every statement it executes, rendered for SQL Server and PostgreSQL, so a
  dialect problem shows here and not first on a deploy;
- its literals against the catalog's own rules and the model seed.
"""
import uuid

import alembic.op
import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.dialects import mssql, postgresql
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 — registers every table on Base.metadata
from app.database import Base
from app.models.audit import AuditLog
from app.models.readiness import (
    BUILTIN_CHECKS,
    ICON_KEYS,
    LEGACY_BUILTIN_CHECKS,
    STATUS_SETS,
    ReadinessCheck,
    ReadinessEntry,
)
from app.routers.admin_readiness import RESERVED_CHECK_CODES
from tests.readiness_seed import _load

M040 = _load("040_well_execution_readiness.py")
CHECKS = ReadinessCheck.__table__
ENTRIES = ReadinessEntry.__table__
AUDIT = AuditLog.__table__
SEVEN = [c["code"] for c in LEGACY_BUILTIN_CHECKS]
_FIELDS = (
    "code", "label", "sort_order", "applies_project", "applies_well", "status_set",
    "locks_with_plan",
)  # fmt: skip


def _engine_at_039() -> sa.Engine:
    engine = sa.create_engine(
        "sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False}
    )

    @sa.event.listens_for(engine, "connect")
    def _gen_random_uuid(dbapi_conn, _record):  # type: ignore[no-untyped-def]
        # sa.Uuid stores 32 hex digits on SQLite.
        dbapi_conn.create_function("gen_random_uuid", 0, lambda: uuid.uuid4().hex)

    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        # create_all seeds what 040 leaves; put back what 039 left.
        conn.execute(CHECKS.delete())
        conn.execute(CHECKS.insert(), [dict(c) for c in LEGACY_BUILTIN_CHECKS])
    return engine


def _run(conn: sa.Connection, direction: str) -> None:
    with Operations.context(MigrationContext.configure(conn)):
        getattr(M040, direction)()
    conn.commit()


def _rows(conn: sa.Connection) -> dict[str, sa.Row]:
    return {r.code: r for r in conn.execute(sa.select(CHECKS)).all()}


def _events(conn: sa.Connection, check_id: uuid.UUID, field: str) -> list[str]:
    return [
        r.new_value
        for r in conn.execute(
            sa.select(AUDIT).where(AUDIT.c.entity_id == check_id, AUDIT.c.field == field)
        ).all()
    ]


def test_upgrade_leaves_the_model_seed_and_audits_each_change() -> None:
    engine = _engine_at_039()
    with engine.connect() as conn:
        _run(conn, "upgrade")
        rows = _rows(conn)
        got = sorted(
            ({f: getattr(r, f) for f in _FIELDS} for r in rows.values()),
            key=lambda c: c["sort_order"],
        )
        want = sorted(
            ({f: c[f] for f in _FIELDS} for c in BUILTIN_CHECKS), key=lambda c: c["sort_order"]
        )
        assert got == want
        assert {c: rows[c].icon_key for c in rows} == {c["code"]: c["icon_key"] for c in BUILTIN_CHECKS}
        assert all(r.retired_at is None for r in rows.values())

        # Each of the seven: one event for the new set and level…
        for code in SEVEN:
            updated = _events(conn, rows[code].id, "readiness_check_updated")
            assert (
                f"Updated readiness check {code}: status set execution (unset reads Not "
                "started); enabled at well level - migration 040"
            ) in updated, code
        # …and one for its label and order, where either changed (FDP: label).
        assert (
            "Updated readiness check FDP: label Field Development Plan -> Approved FDP/IP; "
            "reordered - migration 040"
        ) in _events(conn, rows["FDP"].id, "readiness_check_updated")
        # Well Permits: created once, by this migration, with no user.
        (created,) = conn.execute(
            sa.select(AUDIT).where(
                AUDIT.c.entity_id == rows["WP"].id, AUDIT.c.field == "readiness_check_created"
            )
        ).all()
        assert created.new_value == M040.created_detail() and created.user_id is None
        assert created.entity_type == "readiness_catalog" and created.project_id is None
    engine.dispose()


def test_upgrading_twice_changes_nothing_more() -> None:
    engine = _engine_at_039()
    with engine.connect() as conn:
        _run(conn, "upgrade")
        before = conn.execute(sa.select(sa.func.count()).select_from(AUDIT)).scalar()
        rows = _rows(conn)
        _run(conn, "upgrade")
        assert conn.execute(sa.select(sa.func.count()).select_from(AUDIT)).scalar() == before
        assert _rows(conn) == rows
    engine.dispose()


def test_an_existing_wp_keeps_its_definition_and_gets_no_event() -> None:
    engine = _engine_at_039()
    with engine.connect() as conn:
        own = uuid.uuid4()
        conn.execute(
            CHECKS.insert().values(
                id=own, code="WP", label="Our own WP", team_code="projects",
                applies_project=True, applies_well=False, status_set="standard",
                icon_key="key", locks_with_plan=True, tag_list="", sort_order=5,
            )  # fmt: skip
        )
        conn.commit()
        _run(conn, "upgrade")
        wp = _rows(conn)["WP"]
        # Its label, icon and order are its own; like every check that locks
        # with the plan it moved to the execution set at both levels.
        assert (wp.id, wp.label, wp.icon_key, wp.sort_order) == (own, "Our own WP", "key", 5)
        assert (wp.status_set, wp.applies_well) == ("execution", True)
        assert _events(conn, own, "readiness_check_created") == []
    engine.dispose()


def test_round_trip_restores_034_and_brings_well_permits_back() -> None:
    engine = _engine_at_039()
    with engine.connect() as conn:
        _run(conn, "upgrade")
        project = uuid.uuid4()
        conn.execute(
            ENTRIES.insert(),
            [
                {
                    "id": uuid.uuid4(), "project_id": project, "check_code": code,
                    "scope": "project", "well_project": "P1", "well_name": "",
                    "activity_type": "", "status": status,
                }  # fmt: skip
                for code, status in (("FID", "Not started"), ("BUD", "Completed"))
            ],
        )
        conn.commit()

        _run(conn, "downgrade")
        rows = _rows(conn)
        legacy = {c["code"]: c for c in LEGACY_BUILTIN_CHECKS}
        for code in SEVEN:
            got = {f: getattr(rows[code], f) for f in _FIELDS}
            assert got == {f: legacy[code][f] for f in _FIELDS}, code
        # Well Permits is retired — never deleted — and audited.
        assert rows["WP"].retired_at is not None
        assert _events(conn, rows["WP"].id, "readiness_check_retired") == [
            "Retired readiness check WP (Well Permits) on downgrade - migration 040"
        ]
        # "Not started" isn't a standard status: it reads On Track again.
        statuses = dict(conn.execute(sa.select(ENTRIES.c.check_code, ENTRIES.c.status)).all())
        assert statuses == {"FID": "On Track", "BUD": "Completed"}

        _run(conn, "upgrade")
        rows = _rows(conn)
        assert rows["WP"].retired_at is None
        assert _events(conn, rows["WP"].id, "readiness_check_restored") == [
            "Restored readiness check WP (Well Permits) - migration 040 upgrade"
        ]
        # Still created once: the re-upgrade restores, it doesn't re-seed.
        assert len(_events(conn, rows["WP"].id, "readiness_check_created")) == 1
        assert {c: rows[c].status_set for c in SEVEN} == dict.fromkeys(SEVEN, "execution")
    engine.dispose()


def test_a_wp_an_admin_retired_stays_retired() -> None:
    engine = _engine_at_039()
    with engine.connect() as conn:
        _run(conn, "upgrade")
        conn.execute(
            CHECKS.update().where(CHECKS.c.code == "WP").values(retired_at=sa.func.now())
        )
        conn.commit()
        _run(conn, "downgrade")  # already retired: nothing to retire, no event
        _run(conn, "upgrade")
        wp = _rows(conn)["WP"]
        assert wp.retired_at is not None
        assert _events(conn, wp.id, "readiness_check_restored") == []
    engine.dispose()


# ── The literals ────────────────────────────────────────────────────────────


def test_the_literals_follow_the_catalogs_rules() -> None:
    assert list(M040.GATES) == sorted(M040.GATES, key=lambda c: M040.GATES[c][1])
    assert set(M040.GATES) == set(SEVEN)
    legacy = {c["code"]: (c["label"], c["sort_order"]) for c in LEGACY_BUILTIN_CHECKS}
    for code, (label, order, old_label, old_order) in M040.GATES.items():
        assert (old_label, old_order) == legacy[code], code
        assert label.isascii() and 1 <= len(label) <= 64
        # A label equal to its code would read "FID FID" beside the code.
        assert label != code
        assert 0 <= order <= 10_000
    wp = M040.WELL_PERMITS
    assert wp["code"] not in set(SEVEN) | RESERVED_CHECK_CODES
    assert wp["icon_key"] in ICON_KEYS
    assert wp["status_set"] == M040.EXECUTION and M040.EXECUTION in STATUS_SETS
    assert STATUS_SETS[M040.EXECUTION]["default"] == M040.NOT_STARTED
    assert M040.ON_TRACK in STATUS_SETS[M040.STANDARD]["statuses"]
    detail = M040.created_detail()
    assert detail.isascii() and len(detail) <= 512 and detail.endswith("- migration 040")


# ── The statements, rendered for the production dialects ───────────────────


class _Dialect:
    def __init__(self, name: str) -> None:
        self.name = name


class _Bind:
    """Like the parity test's fake bind: a dialect name and no execute()."""

    def __init__(self, name: str) -> None:
        self.dialect = _Dialect(name)


@pytest.mark.parametrize("direction", ["upgrade", "downgrade"])
@pytest.mark.parametrize(
    ("dialect", "id_function", "other_function"),
    [
        (mssql.dialect(), "newid()", "gen_random_uuid"),
        (postgresql.dialect(), "gen_random_uuid()", "newid"),
    ],
    ids=["mssql", "postgresql"],
)
def test_migration_040_statements_render_for_production_dialects(
    monkeypatch: pytest.MonkeyPatch, dialect, id_function: str, other_function: str, direction: str
) -> None:
    executed: list = []
    monkeypatch.setattr(alembic.op, "execute", lambda stmt, *a, **kw: executed.append(stmt))
    monkeypatch.setattr(alembic.op, "get_bind", lambda: _Bind(dialect.name))
    getattr(M040, direction)()

    # Data only: every statement is Core — no raw SQL, no schema change.
    assert executed and not [s for s in executed if isinstance(s, str)]
    rendered = [str(stmt.compile(dialect=dialect)) for stmt in executed]
    audit_inserts = [sql for sql in rendered if sql.startswith("INSERT INTO audit_logs")]
    assert audit_inserts and all(id_function in sql for sql in audit_inserts)
    for sql in rendered:
        assert other_function not in sql
        # .is_(True/False) renders "IS 1" / "IS 0" — invalid T-SQL.
        for bad in (" IS 1", " IS 0", " IS true", " IS false", " IS NOT 1", " IS NOT 0"):
            assert bad not in sql, sql
    if direction == "upgrade":
        assert len([s for s in rendered if s.startswith("INSERT INTO readiness_checks")]) == 1
