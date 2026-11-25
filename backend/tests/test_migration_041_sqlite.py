"""Migration 041 (docs/equipment-quantity-spec.md §3.2) in the everyday suite.

The suite builds its schema with ``create_all`` and never runs a migration, so
these tests drive 041 directly:

- its upgrade, downgrade and upgrade again, through Alembic's ``Operations`` on
  an in-memory SQLite database put back to what 040 left (no ``takes_quantity``
  column, no ``readiness_quantities`` table) holding the catalog a migrated
  database holds: the Project gates, the Logistics checks and 039's 21
  equipment types;
- every data statement it executes, rendered for SQL Server and PostgreSQL, so a
  dialect problem shows here and not first on a deploy;
- its literals against the model and migration 039's categories.
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
from app.models.readiness import MAX_QUANTITY, MIN_QUANTITY, ReadinessQuantity
from tests import migration_039_scenario as scenario
from tests.readiness_seed import _load, migration_039

M041 = _load("041_equipment_quantity.py")
AUDIT = AuditLog.__table__
TABLE = "readiness_quantities"
# 039's seed: code -> category.
SEEDED = {row["code"]: row["category"] for row in migration_039().seed_checks()}
COUNTED = sorted(c for c, category in SEEDED.items() if category in M041.QUANTITY_CATEGORIES)


def _checks(*extra: str) -> sa.TableClause:
    """``readiness_checks`` as 040 left it (plus ``extra`` columns)."""
    names = (
        "id", "code", "label", "team_code", "applies_project", "applies_well", "status_set",
        "icon_key", "locks_with_plan", "tag_list", "sort_order", "retired_at", "category",
        "applies_by_default",
    )  # fmt: skip
    return sa.table("readiness_checks", *(sa.column(n) for n in (*names, *extra)))


def _insert_check(conn: sa.Connection, **row: object) -> None:
    values = {
        "id": uuid.uuid4().hex, "tag_list": "", "sort_order": 100, "retired_at": None,
        "applies_project": True, "applies_well": True, "status_set": "standard",
        "icon_key": "anchor", "locks_with_plan": False, "category": "",
        "applies_by_default": True, **row,
    }  # fmt: skip
    conn.execute(_checks().insert().values(**values))


def _engine_at_040() -> sa.Engine:
    engine = sa.create_engine(
        "sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False}
    )

    @sa.event.listens_for(engine, "connect")
    def _gen_random_uuid(dbapi_conn, _record):  # type: ignore[no-untyped-def]
        # sa.Uuid stores 32 hex digits on SQLite.
        dbapi_conn.create_function("gen_random_uuid", 0, lambda: uuid.uuid4().hex)

    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        # The model already has 041's column and table; 040 didn't.
        conn.exec_driver_sql(f"DROP TABLE {TABLE}")
        conn.exec_driver_sql("ALTER TABLE readiness_checks DROP COLUMN takes_quantity")
        scenario.ensure_logistics(conn)
        for row in migration_039().seed_checks():
            _insert_check(conn, **row)
        # (``ensure_logistics`` added the plain Logistics checks, PO among
        # them.) An admin's check in a counted category that was retired; a
        # check of ANOTHER team that happens to use the name.
        _insert_check(
            conn, code="OLDV", label="Old vessel", team_code="logistics", category="Vessels",
            applies_by_default=False, retired_at=sa.func.now(),
        )  # fmt: skip
        _insert_check(
            conn, code="P-VES", label="Not logistics", team_code="projects", category="Vessels"
        )
    return engine


def _run(conn: sa.Connection, direction: str) -> None:
    with Operations.context(MigrationContext.configure(conn)):
        getattr(M041, direction)()
    conn.commit()


def _flags(conn: sa.Connection) -> dict[str, bool]:
    checks = _checks("takes_quantity")
    return {
        r.code: bool(r.takes_quantity)
        for r in conn.execute(sa.select(checks.c.code, checks.c.takes_quantity))
    }


def _events(conn: sa.Connection, suffix: str) -> list[str]:
    return sorted(
        r.new_value
        for r in conn.execute(
            sa.select(AUDIT).where(
                AUDIT.c.field == "readiness_check_updated", AUDIT.c.new_value.like(f"%{suffix}")
            )
        )
    )


def test_upgrade_flags_the_counted_logistics_categories_and_audits_each() -> None:
    engine = _engine_at_040()
    with engine.connect() as conn:
        _run(conn, "upgrade")
        flags = _flags(conn)
        flagged = sorted(code for code, on in flags.items() if on)
        # The 20 counted equipment types and the retired one in a counted
        # category — not Permits, not a plain check, not another team's, and no
        # check that locks with the plan.
        assert flagged == sorted([*COUNTED, "OLDV"])
        assert len(COUNTED) == 20 and flags["NNRA"] is False
        assert flags["PO"] is False and flags["P-VES"] is False and flags["FID"] is False

        want = sorted(f"Updated readiness check {code}{M041.TAKES}" for code in flagged)
        assert _events(conn, M041.MARK) == want
        event = conn.execute(sa.select(AUDIT).where(AUDIT.c.new_value == want[0])).one()
        assert (event.entity_type, event.user_id, event.project_id) == (
            "readiness_catalog", None, None,
        )  # fmt: skip

        # No quantity is stated for anything: every number starts blank.
        assert conn.execute(sa.select(sa.func.count()).select_from(sa.table(TABLE))).scalar() == 0
    engine.dispose()


def test_the_table_takes_a_whole_number_in_range_once_per_target() -> None:
    engine = _engine_at_040()
    with engine.connect() as conn:
        _run(conn, "upgrade")
        conn.exec_driver_sql("PRAGMA foreign_keys=OFF")
        numbers = ReadinessQuantity.__table__

        def row(quantity: int, well: str = "") -> dict:
            return {
                "id": uuid.uuid4(), "project_id": uuid.UUID(int=1), "check_code": "PSV",
                "scope": "well" if well else "project", "well_project": "Bonga",
                "well_name": well, "activity_type": "Oil" if well else "", "quantity": quantity,
            }  # fmt: skip

        conn.execute(numbers.insert(), [row(1), row(MAX_QUANTITY, well="W-1")])
        conn.commit()
        for bad in (0, -3, MAX_QUANTITY + 1):
            with pytest.raises(sa.exc.IntegrityError):
                conn.execute(numbers.insert(), [row(bad, well="W-2")])
            conn.rollback()
        # One number per campaign + check + target.
        with pytest.raises(sa.exc.IntegrityError):
            conn.execute(numbers.insert(), [row(5)])
        conn.rollback()
    engine.dispose()


def test_round_trip_drops_the_numbers_and_flags_the_same_checks_again() -> None:
    engine = _engine_at_040()
    with engine.connect() as conn:
        _run(conn, "upgrade")
        flagged = sorted(code for code, on in _flags(conn).items() if on)
        # An admin turns one off and another on before the downgrade.
        checks = _checks("takes_quantity")
        conn.execute(checks.update().where(checks.c.code == "PSV").values(takes_quantity=sa.false()))
        conn.execute(checks.update().where(checks.c.code == "PO").values(takes_quantity=sa.true()))
        conn.commit()

        _run(conn, "downgrade")
        inspector = sa.inspect(conn)
        assert TABLE not in inspector.get_table_names()
        assert "takes_quantity" not in {c["name"] for c in inspector.get_columns("readiness_checks")}
        # Each check that took one when the column went — PO, not PSV — says so.
        took = sorted({*flagged, "PO"} - {"PSV"})
        assert _events(conn, M041.NO_LONGER_TAKES) == sorted(
            f"Updated readiness check {code}{M041.NO_LONGER_TAKES}" for code in took
        )

        # Upgrading again flags the counted categories; the admin's own choices
        # are gone with the column (the downgrade is lossy).
        _run(conn, "upgrade")
        assert sorted(code for code, on in _flags(conn).items() if on) == flagged
        assert len(_events(conn, M041.TAKES)) == 2 * len(flagged)
    engine.dispose()


# ── The literals ────────────────────────────────────────────────────────────


def test_the_literals_match_the_model_and_migration_039() -> None:
    assert (M041.MIN_QUANTITY, M041.MAX_QUANTITY) == (MIN_QUANTITY, MAX_QUANTITY)
    assert set(M041.QUANTITY_CATEGORIES) < set(SEEDED.values())
    assert "Permits" not in M041.QUANTITY_CATEGORIES
    table = ReadinessQuantity.__table__
    assert table.name == M041.TABLE
    (key,) = (c for c in table.constraints if isinstance(c, sa.UniqueConstraint))
    assert (key.name, tuple(c.name for c in key.columns)) == ("uq_readiness_quantity", M041._KEY)
    (bounds,) = (c for c in table.constraints if isinstance(c, sa.CheckConstraint))
    assert bounds.name == "ck_readiness_quantity_range"
    assert str(bounds.sqltext) == f"quantity >= {MIN_QUANTITY} AND quantity <= {MAX_QUANTITY}"
    assert {i.name for i in table.indexes} == {M041.INDEX}
    for detail in (M041.TAKES, M041.NO_LONGER_TAKES):
        longest = f"Updated readiness check {'X' * 16}{detail}"
        assert longest.isascii() and len(longest) <= 512 and detail.endswith(f"- {M041.MARK}")


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
def test_migration_041_statements_render_for_production_dialects(
    monkeypatch: pytest.MonkeyPatch, dialect, id_function: str, other_function: str, direction: str
) -> None:
    executed: list = []
    schema_ops: list[str] = []
    monkeypatch.setattr(alembic.op, "execute", lambda stmt, *a, **kw: executed.append(stmt))
    monkeypatch.setattr(alembic.op, "get_bind", lambda: _Bind(dialect.name))
    for name in ("add_column", "create_table", "create_index", "drop_index", "drop_table", "drop_column"):
        monkeypatch.setattr(
            alembic.op, name, lambda *a, _name=name, **kw: schema_ops.append(_name)
        )
    getattr(M041, direction)()

    if direction == "upgrade":
        assert schema_ops == ["add_column", "create_table", "create_index"]
    else:
        assert schema_ops == ["drop_index", "drop_table", "drop_column"]

    # The only raw SQL is SQL Server's "drop the column's default first".
    raw = [s for s in executed if isinstance(s, str)]
    if direction == "downgrade" and dialect.name == "mssql":
        assert len(raw) == 1 and "DROP CONSTRAINT" in raw[0] and "takes_quantity" in raw[0]
    else:
        assert raw == []

    rendered = [str(s.compile(dialect=dialect)) for s in executed if not isinstance(s, str)]
    audit_inserts = [sql for sql in rendered if sql.startswith("INSERT INTO audit_logs")]
    assert len(audit_inserts) == 1 and id_function in audit_inserts[0]
    for sql in rendered:
        assert other_function not in sql
        # .is_(True/False) renders "IS 1" / "IS 0" — invalid T-SQL.
        for bad in (" IS 1", " IS 0", " IS true", " IS false", " IS NOT 1", " IS NOT 0"):
            assert bad not in sql, sql
    if direction == "upgrade":
        (update,) = [sql for sql in rendered if sql.startswith("UPDATE readiness_checks")]
        assert "takes_quantity" in update
