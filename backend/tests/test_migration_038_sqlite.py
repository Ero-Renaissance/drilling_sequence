"""Migration 038 (spec §4.4) in the everyday suite.

The suite builds its schema with ``create_all`` and never runs a migration, so
these tests drive 038 directly:

- its upgrade and downgrade, step by step, through Alembic's ``Operations`` on an
  in-memory SQLite database built at revision 037 — the scenario in
  migration_038_scenario.py, the same one test_migration_038_mssql.py runs on SQL
  Server in CI. SQLite has no ``gen_random_uuid()``, so the test registers one;
- every statement it executes, rendered for SQL Server and PostgreSQL, so a
  dialect problem (``IS 0``, the wrong id function, a statement that won't
  compile) shows here and not first on a deploy.
"""
import logging
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
from app.models.readiness import ReadinessApplicability
from tests import migration_038_scenario as scenario

M038 = scenario.migration("038")


def _engine_at_037() -> sa.Engine:
    engine = sa.create_engine(
        "sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False}
    )

    @sa.event.listens_for(engine, "connect")
    def _gen_random_uuid(dbapi_conn, _record):  # type: ignore[no-untyped-def]
        # sa.Uuid stores 32 hex digits on SQLite.
        dbapi_conn.create_function("gen_random_uuid", 0, lambda: uuid.uuid4().hex)

    Base.metadata.create_all(engine)
    ReadinessApplicability.__table__.drop(engine)
    return engine


def _run(conn: sa.Connection, direction: str) -> None:
    with Operations.context(MigrationContext.configure(conn)):
        getattr(M038, direction)()
    conn.commit()


def test_migration_038_round_trip(caplog: pytest.LogCaptureFixture) -> None:
    engine = _engine_at_037()
    with engine.connect() as conn:
        seeded = scenario.seed(conn)
        conn.commit()

        with caplog.at_level(logging.WARNING, logger="alembic.runtime.migration"):
            _run(conn, "upgrade")
        scenario.assert_upgraded(conn, seeded)
        # The governed check outside the Projects team is logged, by code only.
        (record,) = [r for r in caplog.records if r.name == "alembic.runtime.migration"]
        assert seeded.governed_code in record.getMessage()
        assert "FP-A" not in record.getMessage()

        scenario.change_after_upgrade(conn, seeded)
        conn.commit()
        _run(conn, "downgrade")
        scenario.assert_downgraded(conn, seeded)

        # Upgrading again converts the N/A values the downgrade wrote back.
        _run(conn, "upgrade")
        rows = scenario.applicability(conn, seeded.campaign_id)
        assert {k: r.applies for k, r in rows.items()} == {
            ("NAV", ""): False,
            ("NAV", "W1"): True,
            ("NAV", "W2"): False,
            ("NAV", "W4"): True,
            ("PO", "W3"): False,
            ("CTR", ""): False,
            ("CTR", "W1"): False,
            (seeded.retired_code, ""): False,
        }

        scenario.teardown(conn, seeded)
        conn.commit()
    engine.dispose()


def test_migration_038_with_nothing_to_convert_writes_nothing() -> None:
    """No team N/A and no withdrawn check (a bare catalog of the seven gates): no
    row and no event — in particular no per-campaign event counting zero."""
    engine = _engine_at_037()
    with engine.connect() as conn:
        _run(conn, "upgrade")
        assert conn.execute(sa.select(sa.func.count()).select_from(scenario.ROWS)).scalar() == 0
        audit = scenario.AUDIT
        assert conn.execute(sa.select(audit.c.field)).scalars().all() == []
    engine.dispose()


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
    for name in ("create_table", "create_index", "drop_index", "drop_table"):
        monkeypatch.setattr(alembic.op, name, lambda *a, **kw: None)
    getattr(M038, direction)()
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
def test_migration_038_statements_render_for_production_dialects(
    monkeypatch: pytest.MonkeyPatch, dialect, id_function: str, other_function: str, direction: str
) -> None:
    statements = _statements(monkeypatch, dialect.name, direction)
    assert statements
    rendered = [str(stmt.compile(dialect=dialect)) for stmt in statements]
    inserts = [sql for sql in rendered if sql.startswith("INSERT")]
    assert inserts and all(id_function in sql for sql in inserts)
    for sql in rendered:
        assert other_function not in sql
        # .is_(True/False) renders "IS 1" / "IS 0" — invalid T-SQL.
        for bad in (" IS 1", " IS 0", " IS true", " IS false", " IS NOT 1", " IS NOT 0"):
            assert bad not in sql, sql
