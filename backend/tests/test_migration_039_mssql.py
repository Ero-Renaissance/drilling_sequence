"""Migration 039 on SQL Server — upgrade, downgrade, upgrade (spec §4.5, "Tests").

The main suite never runs a migration (test_migration_039_sqlite.py replays
039's steps on SQLite); this module runs the real one, through Alembic's own
env.py, against the database in DATABASE_URL. It skips unless that is SQL
Server, like test_concurrency_mssql.py, and runs in the CI backend-mssql job
after test_migration_038_mssql.py:

    at head: check the seed → add what admins and teams will add → downgrade to
    038 (every check that starts unticked retired, both columns and their
    default constraints dropped) → check → an admin restores and retires again
    one the downgrade retired → upgrade back to head → check: all 21 active,
    starting unticked and categorised, and the admin's retirement kept.

The scenario and its checks are migration_039_scenario.py.

SYNCHRONOUS on purpose: alembic/env.py calls asyncio.run, which can't run inside
a running event loop. Seeding and checks run each in their own asyncio.run, over
the app's own async URL (``run_sync`` hands the scenario a sync connection).

Run it only against a THROWAWAY database (CI's container): the round trip
retires and restores catalog checks and loses categories an admin set. It
refuses a database that holds any campaign. PostgreSQL has no CI job: before a
PostgreSQL deploy, run this module by hand against a throwaway PostgreSQL
database, widening the skip guard below.
"""
import asyncio
import os
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
import sqlalchemy as sa
from alembic.config import Config
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

from alembic import command
from app.models.project import Project
from tests import migration_039_scenario as scenario

_URL = os.environ.get("DATABASE_URL", "")
# The default-constraint checks read SQL Server's catalog; the rest of the round
# trip also runs on PostgreSQL once the skip guard below is widened.
_IS_MSSQL = _URL.startswith("mssql")
pytestmark = pytest.mark.skipif(
    not _URL.startswith("mssql"),
    reason="Migration 039's round trip is checked on SQL Server (the production engine)",
)

BACKEND_DIR = Path(__file__).resolve().parents[1]


def _alembic_config() -> Config:
    """No ini file on purpose: alembic.ini's logging section (fileConfig) would
    reconfigure the app's loggers for the rest of the session. env.py sets the
    URL from app settings, i.e. DATABASE_URL."""
    cfg = Config()
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    return cfg


def _on_db(fn: Callable[..., Any], *args: Any) -> Any:
    """Run ``fn(sync_connection, *args)`` in one committed transaction."""

    async def run() -> Any:
        engine = create_async_engine(_URL, poolclass=NullPool)
        try:
            async with engine.begin() as conn:
                return await conn.run_sync(fn, *args)
        finally:
            await engine.dispose()

    return asyncio.run(run())


def _campaign_count(conn: sa.Connection) -> int:
    return conn.execute(sa.select(sa.func.count()).select_from(Project.__table__)).scalar_one()


def _default_constraints(conn: sa.Connection) -> list[str]:
    """The columns of readiness_checks that carry a DEFAULT constraint (SQL Server only)."""
    return list(
        conn.execute(
            sa.text(
                "SELECT col.name FROM sys.default_constraints dc "
                "JOIN sys.columns col ON col.object_id = dc.parent_object_id "
                "AND col.column_id = dc.parent_column_id "
                "WHERE dc.parent_object_id = OBJECT_ID(N'readiness_checks')"
            )
        ).scalars()
    )


def test_migration_039_round_trips_on_sql_server() -> None:
    from app.config import settings

    # env.py migrates settings.database_url; this test seeds and checks _URL.
    assert settings.database_url == _URL, "Alembic would migrate another database"
    if _on_db(_campaign_count):
        pytest.fail(
            "test_migration_039_mssql needs a throwaway database with no campaigns: its "
            "downgrade/upgrade round trip retires and restores catalog checks, lossily"
        )

    cfg = _alembic_config()
    command.upgrade(cfg, "head")
    seeded = None
    try:
        _on_db(scenario.assert_seeded)
        if _IS_MSSQL:
            assert {"category", "applies_by_default"} <= set(_on_db(_default_constraints))
        seeded = _on_db(scenario.seed)

        command.downgrade(cfg, "038")
        _on_db(scenario.assert_downgraded, seeded)
        if _IS_MSSQL:
            # _drop_column dropped each column's default constraint first.
            assert not {"category", "applies_by_default"} & set(_on_db(_default_constraints))
        # An admin restores and retires again a check the downgrade retired: its
        # latest retire/restore event is then the admin's (spec §4.5).
        _on_db(scenario.change_after_downgrade, seeded)

        command.upgrade(cfg, "head")
        _on_db(scenario.assert_reupgraded, seeded)
    finally:
        command.upgrade(cfg, "head")
        if seeded is not None:
            _on_db(scenario.teardown, seeded)
    # The round trip ends where it began: all 21 active, starting unticked and
    # categorised, each created once.
    _on_db(scenario.assert_seeded)
