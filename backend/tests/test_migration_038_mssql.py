"""Migration 038 on SQL Server — its data steps, both ways (spec §4.4, "Test").

The main suite never runs a migration (test_migration_038_sqlite.py replays 038's
steps on SQLite); this module runs the real one, through Alembic's own env.py,
against the database in DATABASE_URL. It skips unless that is SQL Server, like
test_concurrency_mssql.py, and runs in the CI backend-mssql job:

    downgrade to 037 → seed → upgrade to 038 → check → change what the app will
    change (untick a Completed Logistics check; tick a well under an unticked
    field project) → downgrade → check → upgrade back to head.

The scenario and its checks are migration_038_scenario.py. Among them: the Project
gates' N/A entries are untouched, and a note on a converted entry ends up in the
migration's audit event.

SYNCHRONOUS on purpose: alembic/env.py calls asyncio.run, which can't run inside
a running event loop. Seeding and checks run each in their own asyncio.run, over
the app's own async URL (``run_sync`` hands the scenario a sync connection).

Run it only against a THROWAWAY database (CI's container): the round trip
rewrites every campaign's readiness, and the downgrade is lossy (a status kept
under an untick becomes N/A). It refuses a database that holds any campaign.
PostgreSQL has no CI job: before a PostgreSQL deploy, run this module by hand
against a throwaway PostgreSQL database, widening the skip guard below.
"""
import asyncio
import logging
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
from tests import migration_038_scenario as scenario

_URL = os.environ.get("DATABASE_URL", "")
pytestmark = pytest.mark.skipif(
    not _URL.startswith("mssql"),
    reason="Migration 038's data steps are checked on SQL Server (the production engine)",
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


def test_migration_038_round_trips_on_sql_server(caplog: pytest.LogCaptureFixture) -> None:
    from app.config import settings

    # env.py migrates settings.database_url; this test seeds and checks _URL.
    assert settings.database_url == _URL, "Alembic would migrate another database"
    if _on_db(_campaign_count):
        pytest.fail(
            "test_migration_038_mssql needs a throwaway database with no campaigns: its "
            "downgrade/upgrade round trip rewrites every campaign's readiness, lossily"
        )

    cfg = _alembic_config()
    command.downgrade(cfg, "037")
    seeded = None
    try:
        seeded = _on_db(scenario.seed)
        with caplog.at_level(logging.WARNING, logger="alembic.runtime.migration"):
            command.upgrade(cfg, "038")
        _on_db(scenario.assert_upgraded, seeded)
        # The governed check outside the Projects team is logged.
        assert seeded.governed_code in caplog.text

        _on_db(scenario.change_after_upgrade, seeded)
        command.downgrade(cfg, "037")
        _on_db(scenario.assert_downgraded, seeded)
    finally:
        command.upgrade(cfg, "head")
        if seeded is not None:
            _on_db(scenario.teardown, seeded)
