"""Regression guard: the Alembic migrations must build the schema the models declare.

The rest of the suite (and local dev) build the schema with ``Base.metadata.create_all``
— straight from the models — so a migration that has *drifted* from the models is
invisible to them. Production (PostgreSQL / SQL Server) builds the schema from the
**migrations** instead. That gap let migration 003 ship without the ``server_default``
its models declare on ``audit_logs.timestamp`` (and two siblings), so on SQL Server the
column had no DB default and every INSERT failed (``Cannot insert NULL into timestamp``).

The migrations can't be executed on SQLite (they use ``ALTER ... ADD/DROP CONSTRAINT``,
unsupported there — which is why the app uses ``create_all`` on SQLite). So instead of
running them against a database, this test *replays* each migration's ``upgrade()``
against a lightweight, dialect-independent recorder that captures the net set of columns
the migrations build, then compares each model column against what the migrations declare.

It guards the harmful drift direction: a model column that declares a ``server_default``
the migration omits (the ORM then omits the column from INSERT and expects the DB to fill
it — which only works if the migration created the default), and columns the migrations
forget entirely.
"""
from contextlib import contextmanager
from pathlib import Path

import alembic.op
import sqlalchemy as sa
from alembic.config import Config
from alembic.script import ScriptDirectory

import app.models  # noqa: F401 — importing registers every table on Base.metadata
from app.database import Base

BACKEND_DIR = Path(__file__).resolve().parents[1]


class _FakeDialect:
    # Migrations branch on op.get_bind().dialect.name for MSSQL-only steps; the base
    # (non-MSSQL) schema is what the models represent, so report a non-MSSQL dialect.
    name = "sqlite"


class _FakeBind:
    dialect = _FakeDialect()


class _SchemaRecorder:
    """Replays migration ``op.*`` calls into ``{table: {column_name: Column}}``.

    Only the operations that affect the net column set are meaningful; constraint/index
    ops are no-ops here because this test checks columns and their server defaults, not
    constraints. ``batch_alter_table`` (the SQLite-compatible ALTER form) is replayed by
    routing the batch ops back to this recorder against the batch's table.
    """

    def __init__(self) -> None:
        self.tables: dict[str, dict[str, sa.Column]] = {}

    def create_table(self, name, *args, **kw):
        self.tables[name] = {a.name: a for a in args if isinstance(a, sa.Column)}

    def add_column(self, table, column, **kw):
        self.tables.setdefault(table, {})[column.name] = column

    def drop_column(self, table, column, **kw):
        self.tables.get(table, {}).pop(column, None)

    def drop_table(self, name, **kw):
        self.tables.pop(name, None)

    def get_bind(self):
        return _FakeBind()

    @contextmanager
    def batch_alter_table(self, table_name, **kw):
        yield _BatchProxy(self, table_name)

    def _noop(self, *args, **kw):
        return None

    # Constraint / index / data ops don't change the column server-default comparison.
    create_index = drop_index = create_foreign_key = _noop
    drop_constraint = create_unique_constraint = alter_column = execute = _noop


class _BatchProxy:
    """The object yielded by ``with op.batch_alter_table(...)`` — same ops, minus
    the table argument (the batch already knows its table)."""

    def __init__(self, recorder: _SchemaRecorder, table_name: str) -> None:
        self._recorder = recorder
        self._table = table_name

    def add_column(self, column, **kw):
        self._recorder.add_column(self._table, column, **kw)

    def drop_column(self, column, **kw):
        self._recorder.drop_column(self._table, column, **kw)

    def _noop(self, *args, **kw):
        return None

    drop_constraint = create_unique_constraint = alter_column = _noop


def test_migrations_declare_what_the_models_require(monkeypatch):
    recorder = _SchemaRecorder()
    for op_name in (
        "create_table", "add_column", "drop_column", "drop_table", "get_bind",
        "create_index", "drop_index", "create_foreign_key", "drop_constraint",
        "create_unique_constraint", "alter_column", "execute", "batch_alter_table",
    ):
        monkeypatch.setattr(alembic.op, op_name, getattr(recorder, op_name))

    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    script = ScriptDirectory.from_config(cfg)

    # walk_revisions yields head -> base; replay base -> head so add_column sees its table.
    for sc in reversed(list(script.walk_revisions())):
        sc.module.upgrade()

    problems: list[str] = []
    for table in Base.metadata.sorted_tables:
        if table.name == "alembic_version":
            continue
        built = recorder.tables.get(table.name)
        if built is None:
            problems.append(f"table '{table.name}' is never created by the migrations")
            continue
        for col in table.columns:
            if col.name not in built:
                problems.append(f"{table.name}.{col.name}: column missing from migrations")
                continue
            # Harmful direction: model relies on a DB-side default the migration omits.
            if col.server_default is not None and built[col.name].server_default is None:
                problems.append(
                    f"{table.name}.{col.name}: model declares server_default but the "
                    f"migration creates the column without one"
                )

    assert not problems, "Model/migration drift detected:\n  " + "\n  ".join(problems)
