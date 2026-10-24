"""Migration 039 (spec §4.5) in the everyday suite.

The suite builds its schema with ``create_all`` and never runs a migration, so
these tests drive 039 directly:

- its upgrade, downgrade and upgrade again, through Alembic's ``Operations`` on
  an in-memory SQLite database built at revision 038 — the scenario in
  migration_039_scenario.py, the same one test_migration_039_mssql.py runs on SQL
  Server in CI. SQLite has no ``gen_random_uuid()``, so the test registers one;
- every statement it executes, rendered for SQL Server and PostgreSQL, so a
  dialect problem (``IS 0``, the wrong id function, a statement that won't
  compile) shows here and not first on a deploy;
- the seed literals against the catalog's own rules (codes, icons, labels).
"""
import re
import uuid

import alembic.op
import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from pydantic import TypeAdapter
from sqlalchemy.dialects import mssql, postgresql
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 — registers every table on Base.metadata
from app.database import Base
from app.models.readiness import BUILTIN_CHECKS, ICON_KEYS
from app.schemas.readiness import Category
from tests import migration_039_scenario as scenario

M039 = scenario.M039


def _engine_at_038() -> sa.Engine:
    engine = sa.create_engine(
        "sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False}
    )

    @sa.event.listens_for(engine, "connect")
    def _gen_random_uuid(dbapi_conn, _record):  # type: ignore[no-untyped-def]
        # sa.Uuid stores 32 hex digits on SQLite.
        dbapi_conn.create_function("gen_random_uuid", 0, lambda: uuid.uuid4().hex)

    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        # The model already has 039's columns; 038 didn't.
        conn.exec_driver_sql("ALTER TABLE readiness_checks DROP COLUMN category")
        conn.exec_driver_sql("ALTER TABLE readiness_checks DROP COLUMN applies_by_default")
        scenario.ensure_logistics(conn)
    return engine


def _run(conn: sa.Connection, direction: str) -> None:
    with Operations.context(MigrationContext.configure(conn)):
        getattr(M039, direction)()
    conn.commit()


def test_migration_039_round_trip() -> None:
    engine = _engine_at_038()
    with engine.connect() as conn:
        _run(conn, "upgrade")
        scenario.assert_seeded(conn)

        seeded = scenario.seed(conn)
        conn.commit()
        _run(conn, "downgrade")
        scenario.assert_downgraded(conn, seeded)
        # An admin restores and retires again a check the downgrade retired.
        scenario.change_after_downgrade(conn, seeded)
        conn.commit()

        _run(conn, "upgrade")
        scenario.assert_reupgraded(conn, seeded)

        # And once more: a second round trip restores the same checks again,
        # each with one more event pair and never a second created event.
        before = {
            code: scenario._counts_039(conn, scenario._check(conn, code).id)
            for code in scenario.SEEDED
        }
        _run(conn, "downgrade")
        _run(conn, "upgrade")
        for code, want in scenario.SEEDED.items():
            row = scenario._check(conn, code)
            assert row.retired_at is None and row.applies_by_default is False, code
            assert row.category == want["category"], code
            retired, restored = before[code]
            assert scenario._counts_039(conn, row.id) == (retired + 1, restored + 1), code
            assert len(scenario._events(conn, row.id, "readiness_check_created")) == 1
        # The admin's retirement still stands: the second downgrade retired only
        # active checks, and 039 has never restored it.
        readmin = scenario._check(conn, seeded.readmin_code)
        assert readmin.retired_at is not None and readmin.applies_by_default is False
        assert scenario._counts_039(conn, readmin.id) == (1, 0)

        scenario.teardown(conn, seeded)
        conn.commit()
    engine.dispose()


def test_a_code_that_already_exists_keeps_its_definition_and_gets_no_event() -> None:
    """Inserted only where the code is absent (036's convention): an admin's own
    PSV keeps its label, icon and lock behaviour, gets no created event and no
    category, and starts ticked — 039 never rewrites a check it didn't seed."""
    engine = _engine_at_038()
    with engine.connect() as conn:
        psv_id = uuid.uuid4()
        conn.execute(
            scenario.CHECKS_038.insert().values(
                id=psv_id,
                code="PSV",
                label="Our own PSV",
                team_code="logistics",
                applies_project=True,
                applies_well=False,
                status_set="standard",
                icon_key="ship",
                locks_with_plan=False,
                tag_list="",
                sort_order=5,
            )
        )
        conn.commit()
        _run(conn, "upgrade")

        psv = scenario._check(conn, "PSV")
        assert (psv.label, psv.icon_key, psv.applies_well, psv.sort_order) == (
            "Our own PSV",
            "ship",
            False,
            5,
        )
        assert psv.category == "" and psv.applies_by_default is True
        assert scenario._events(conn, psv_id, "readiness_check_created") == []
        # The other 20 are seeded as usual.
        others = [c for c in scenario.SEEDED if c != "PSV"]
        for code in others:
            row = scenario._check(conn, code)
            assert row.applies_by_default is False and row.category, code
            assert len(scenario._events(conn, row.id, "readiness_check_created")) == 1
        created = conn.execute(
            sa.select(sa.func.count())
            .select_from(scenario.AUDIT)
            .where(scenario.AUDIT.c.field == "readiness_check_created")
        ).scalar()
        assert created == len(others)
    engine.dispose()


def test_downgrade_with_nothing_starting_unticked_retires_nothing() -> None:
    """No check starts unticked (every seeded code was taken): the downgrade
    retires nothing and writes no event; it still drops both columns."""
    engine = _engine_at_038()
    with engine.connect() as conn:
        _run(conn, "upgrade")
        checks = scenario.CHECKS
        conn.execute(
            checks.update()
            .where(checks.c.applies_by_default == sa.false())
            .values(applies_by_default=sa.true())
        )
        conn.commit()
        _run(conn, "downgrade")
        assert conn.execute(
            sa.select(scenario.AUDIT.c.field).where(
                scenario.AUDIT.c.field == "readiness_check_retired"
            )
        ).all() == []
        columns = {c["name"] for c in sa.inspect(conn).get_columns("readiness_checks")}
        assert not {"category", "applies_by_default"} & columns
    engine.dispose()


# ── The seed literals ───────────────────────────────────────────────────────

_PER_TYPE = ("code", "label", "category", "icon_key", "sort_order")
_CATEGORY = TypeAdapter(Category)


def test_the_seed_is_the_21_equipment_types_of_the_spec() -> None:
    rows = M039.seed_checks()
    assert [r["code"] for r in rows] == [
        "RW", "DSV", "SEV", "AHTS", "FSIV", "PSV", "LHT", "TB", "PC",
        "JUB", "ENV", "HB", "CBG", "RP", "LBT", "FBT", "CB", "ACB", "MB",
        "CR", "NNRA",
    ]  # fmt: skip
    categories = {r["category"]: r["icon_key"] for r in rows}
    assert categories == {
        "Aviation": "helicopter",
        "Vessels": "anchor",
        "Barges": "container",
        "Land transport": "bus",
        "Lifting": "construction",
        "Permits": "radiation",
    }
    # The labels are the seed list's, exactly as 036 seeded the equipment types.
    m036 = scenario.migration("036")
    assert [(r["code"], r["label"], r["category"]) for r in rows] == list(m036.EQUIPMENT)

    taken = {c["code"] for c in BUILTIN_CHECKS} | {c[0] for c in m036.LOGISTICS_CHECKS} | {"CON"}
    orders = [r["sort_order"] for r in rows]
    assert orders == sorted(orders) and len(set(orders)) == len(orders)
    assert min(orders) >= 100 > max(c[5] for c in m036.LOGISTICS_CHECKS)
    for r in rows:
        assert re.fullmatch(r"^[A-Z][A-Z0-9-]{1,7}$", r["code"]), r
        assert r["code"] not in taken, r
        assert r["icon_key"] in ICON_KEYS, r
        assert r["label"].isascii() and 1 <= len(r["label"]) <= 64, r
        assert r["category"].isascii() and len(r["category"]) <= 64, r
        # What the admin API would accept as a category — no ';' among it, so
        # the seed's created detail ends as 039's re-upgrade reads it.
        assert _CATEGORY.validate_python(r["category"]) == r["category"], r
        # The shape every equipment check shares (§3.9): Logistics, both levels,
        # standard, operational, no tag list, starts unticked.
        shape = {k: v for k, v in r.items() if k not in _PER_TYPE}
        assert shape == {
            "team_code": "logistics",
            "applies_project": True,
            "applies_well": True,
            "status_set": "standard",
            "locks_with_plan": False,
            "tag_list": "",
            "applies_by_default": False,
        }, r
        detail = M039.created_detail(r)
        assert detail.isascii() and len(detail) <= 512
        assert detail.endswith(f"; category {r['category']}; starts unticked - migration 039")


# ── The statements, rendered for the production dialects ───────────────────


class _Dialect:
    def __init__(self, name: str) -> None:
        self.name = name


class _Bind:
    """Like the parity test's fake bind: a dialect name and no execute()."""

    def __init__(self, name: str) -> None:
        self.dialect = _Dialect(name)


def _statements(monkeypatch: pytest.MonkeyPatch, dialect_name: str, direction: str) -> list:
    executed: list = []
    monkeypatch.setattr(alembic.op, "execute", lambda stmt, *a, **kw: executed.append(stmt))
    monkeypatch.setattr(alembic.op, "get_bind", lambda: _Bind(dialect_name))
    for name in ("add_column", "drop_column"):
        monkeypatch.setattr(alembic.op, name, lambda *a, **kw: None)
    getattr(M039, direction)()
    return executed


@pytest.mark.parametrize("direction", ["upgrade", "downgrade"])
@pytest.mark.parametrize(
    ("dialect", "id_function", "other_function"),
    [
        (mssql.dialect(), "newid()", "gen_random_uuid"),
        (postgresql.dialect(), "gen_random_uuid()", "newid"),
    ],
    ids=["mssql", "postgresql"],
)
def test_migration_039_statements_render_for_production_dialects(
    monkeypatch: pytest.MonkeyPatch, dialect, id_function: str, other_function: str, direction: str
) -> None:
    statements = _statements(monkeypatch, dialect.name, direction)
    assert statements
    # The SQL Server default-constraint drop is T-SQL text (fixed identifiers);
    # everything else is Core.
    raw = [s for s in statements if isinstance(s, str)]
    core = [s for s in statements if not isinstance(s, str)]
    if direction == "downgrade" and dialect.name == "mssql":
        assert len(raw) == 2 and all("sys.default_constraints" in s for s in raw)
    else:
        assert raw == []
    rendered = [str(stmt.compile(dialect=dialect)) for stmt in core]
    audit_inserts = [sql for sql in rendered if sql.startswith("INSERT INTO audit_logs")]
    assert audit_inserts and all(id_function in sql for sql in audit_inserts)
    for sql in rendered:
        assert other_function not in sql
        # .is_(True/False) renders "IS 1" / "IS 0" — invalid T-SQL.
        for bad in (" IS 1", " IS 0", " IS true", " IS false", " IS NOT 1", " IS NOT 0"):
            assert bad not in sql, sql
    if direction == "upgrade":
        # 21 checks, each with its created event, then the re-upgrade steps.
        check_inserts = [sql for sql in rendered if sql.startswith("INSERT INTO readiness_checks")]
        assert len(check_inserts) == 21
