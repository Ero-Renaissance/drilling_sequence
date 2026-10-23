"""Readiness writes under a CASE-INSENSITIVE collation, as SQL Server's default.

SQL Server compares the readiness name columns case-insensitively, so field
projects "Bonga Phase 3" and "BONGA PHASE 3" (or wells "W-1" and "w-1") are ONE
target to its unique keys (``uq_readiness_entry``, ``uq_readiness_applicability``).
A write must find the target's own stored row the way the database does — by a
SQL equality query — before it decides update vs insert; deciding from an
exact-case Python dict inserts a second row and hits the unique key (500).

The suite's SQLite engine compares exactly, so this module swaps in its own
engine whose name columns are ``COLLATE NOCASE``: the same comparison, in the
equality filters and in the unique constraints, as SQL Server's default
collation. ``test_the_fixture_compares_names_like_sql_server`` pins that the
simulation is real, so the other tests can't pass vacuously.
"""
import uuid
from collections.abc import AsyncGenerator

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import MetaData, String, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base
from app.models.readiness import ReadinessApplicability, ReadinessEntry
from app.services.readiness_effective import EntryIndex
from tests.conftest import TEST_DB_URL
from tests.test_readiness_applicability_api import (
    ACT,
    FP,
    _activity,
    _apply,
    _catalog,
    _details,
    _put,
)

FP_UPPER = FP.upper()  # "BONGA PHASE 3": the same field project to SQL Server

# Every column a readiness write compares a target's names on.
_NAME_COLUMNS = ("well_project", "well_name", "activity_type")
_CI_TABLES = ("activities", "readiness_entries", "readiness_applicability")


def _ci_metadata() -> MetaData:
    """A copy of the app's schema, with the name columns compared
    case-insensitively (the copy keeps every table, so foreign keys resolve)."""
    metadata = MetaData()
    for table in Base.metadata.sorted_tables:
        copy = table.to_metadata(metadata)
        if table.name in _CI_TABLES:
            for name in _NAME_COLUMNS:
                column = copy.c[name]
                column.type = String(column.type.length, collation="NOCASE")
    return metadata


_CI_METADATA = _ci_metadata()
_ci_engine = create_async_engine(TEST_DB_URL, connect_args={"check_same_thread": False})
_CISessionLocal = async_sessionmaker(_ci_engine, class_=AsyncSession, expire_on_commit=False)


@pytest_asyncio.fixture(autouse=True)
async def setup_db() -> AsyncGenerator[None, None]:
    """Overrides the suite's autouse fixture: this module's own engine. Every
    other table comes from the app's own metadata — so its ``after_create`` seed
    hooks (the built-in teams and gates) still run — and the three compared
    tables from the collated copy; the ORM addresses them by name."""
    async with _ci_engine.begin() as conn:
        await conn.run_sync(
            Base.metadata.create_all,
            tables=[t for t in Base.metadata.sorted_tables if t.name not in _CI_TABLES],
        )
        await conn.run_sync(
            _CI_METADATA.create_all, tables=[_CI_METADATA.tables[n] for n in _CI_TABLES]
        )
    yield
    async with _ci_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)  # by name: the copies too


@pytest_asyncio.fixture
async def db() -> AsyncGenerator[AsyncSession, None]:
    """Overrides the suite's session — the clients' requests run on it."""
    async with _CISessionLocal() as session:
        yield session


# ── Helpers ─────────────────────────────────────────────────────────────────


def _well(name: str, project: str = FP) -> dict:
    return {"scope": "well", "well_project": project, "well_name": name, "activity_type": ACT}


async def _case_variant_campaign(client: AsyncClient, db: AsyncSession) -> str:
    """Field projects that differ only by case, and two wells that do too."""
    await _catalog(client, db)
    pid = (await client.post("/api/projects", json={"name": "Collation"})).json()["id"]
    await _activity(client, pid, "W-1")
    await _activity(client, pid, "w-1")
    await _activity(client, pid, "W-9", project=FP_UPPER)
    return pid


async def _entries(db: AsyncSession, pid: str, code: str) -> list[tuple]:
    return sorted(
        (e.scope, e.well_project, e.well_name, e.status)
        for e in (
            await db.execute(
                select(ReadinessEntry).where(
                    ReadinessEntry.project_id == uuid.UUID(pid),
                    ReadinessEntry.check_code == code,
                )
            )
        ).scalars()
    )


async def _applicability(db: AsyncSession, pid: str) -> list[ReadinessApplicability]:
    return list(
        (
            await db.execute(
                select(ReadinessApplicability)
                .where(ReadinessApplicability.project_id == uuid.UUID(pid))
                .order_by(ReadinessApplicability.check_code)
            )
        ).scalars()
    )


# ── The simulation is real ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_the_fixture_compares_names_like_sql_server(
    client: AsyncClient, db: AsyncSession
) -> None:
    pid = await _case_variant_campaign(client, db)
    assert (await _put(client, pid, "FDP", {"well_project": FP}, "Completed")).status_code == 200
    found = (
        await db.execute(select(ReadinessEntry).where(ReadinessEntry.well_project == FP_UPPER))
    ).scalars().all()
    assert [e.well_project for e in found] == [FP]  # equality ignores case

    db.add(
        ReadinessEntry(
            project_id=uuid.UUID(pid),
            check_code="FDP",
            scope="project",
            well_project=FP_UPPER,
            well_name="",
            activity_type="",
            status="Behind",
        )
    )
    with pytest.raises(Exception, match="UNIQUE constraint failed"):
        await db.flush()  # and so does the unique key
    await db.rollback()


# ── Status writes ───────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_a_gate_write_on_a_case_variant_field_project_updates_the_stored_row(
    client: AsyncClient, db: AsyncSession
) -> None:
    pid = await _case_variant_campaign(client, db)
    assert (await _put(client, pid, "FDP", {"well_project": FP}, "Completed")).status_code == 200

    r = await _put(client, pid, "FDP", {"well_project": FP_UPPER}, "Behind")
    assert r.status_code == 200, r.text
    # One row — the stored one, updated — and the audit's old value is what it held.
    assert await _entries(db, pid, "FDP") == [("project", FP, "", "Behind")]
    assert (await _details(db, pid, "readiness_updated"))[-1] == (
        f"FDP for {FP_UPPER}: Completed -> Behind"
    )


@pytest.mark.asyncio
async def test_a_well_status_write_on_a_case_variant_well_updates_the_stored_row(
    client: AsyncClient, db: AsyncSession
) -> None:
    pid = await _case_variant_campaign(client, db)
    assert (await _put(client, pid, "PO", _well("W-1"), "Completed")).status_code == 200

    r = await _put(client, pid, "PO", _well("w-1"), "Behind")
    assert r.status_code == 200, r.text
    assert await _entries(db, pid, "PO") == [("well", FP, "W-1", "Behind")]


@pytest.mark.asyncio
async def test_reset_to_project_on_a_case_variant_well_drops_the_stored_override(
    client: AsyncClient, db: AsyncSession
) -> None:
    pid = await _case_variant_campaign(client, db)
    assert (await _put(client, pid, "PO", {"well_project": FP}, "Completed")).status_code == 200
    assert (await _put(client, pid, "PO", _well("W-1"), "Behind")).status_code == 200

    r = await client.post(f"/api/projects/{pid}/readiness/PO/reset", json=_well("w-1"))
    assert r.status_code == 200, r.text
    assert (r.json()["status"], r.json()["source"]) == ("Completed", "project")
    assert await _entries(db, pid, "PO") == [("project", FP, "", "Completed")]
    assert await _details(db, pid, "readiness_reset") == [
        f"PO for w-1 ({FP}, {ACT}): Behind -> Completed (now follows the field project)"
    ]


# ── Ticks ───────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_a_tick_on_a_case_variant_field_project_reads_the_stored_row(
    client: AsyncClient, db: AsyncSession
) -> None:
    pid = await _case_variant_campaign(client, db)
    assert (await _apply(client, pid, {"scope": "project", "well_project": FP}, {"NAV": False})).status_code == 200

    # Already "doesn't apply" to the database: nothing written, nothing audited.
    r = await _apply(client, pid, {"scope": "project", "well_project": FP_UPPER}, {"NAV": False})
    assert r.status_code == 200, r.text
    rows = await _applicability(db, pid)
    assert [(a.check_code, a.well_project, a.applies) for a in rows] == [("NAV", FP, False)]
    assert len(await _details(db, pid)) == 1

    # Ticking it back removes the stored row.
    r = await _apply(client, pid, {"scope": "project", "well_project": FP_UPPER}, {"NAV": True})
    assert r.status_code == 200, r.text
    assert await _applicability(db, pid) == []
    assert (await _details(db, pid))[-1] == (
        f"NAV: does not apply -> applies; for {FP_UPPER}"
    )


@pytest.mark.asyncio
async def test_a_tick_on_a_case_variant_well_reads_the_stored_row(
    client: AsyncClient, db: AsyncSession
) -> None:
    pid = await _case_variant_campaign(client, db)
    assert (await _apply(client, pid, _well("W-1"), {"PO": False})).status_code == 200

    r = await _apply(client, pid, _well("w-1"), {"PO": False})
    assert r.status_code == 200, r.text
    rows = await _applicability(db, pid)
    assert [(a.check_code, a.well_name, a.applies) for a in rows] == [("PO", "W-1", False)]
    assert len(await _details(db, pid)) == 1

    # Follow project removes the stored row.
    r = await _apply(client, pid, _well("w-1"), {"PO": None})
    assert r.status_code == 200, r.text
    assert await _applicability(db, pid) == []
    assert (await _details(db, pid))[-1] == (
        f"PO: does not apply -> follows field project; for w-1 ({FP}, {ACT})"
    )



@pytest.mark.asyncio
async def test_a_well_under_a_case_variant_field_project_writes_from_what_its_lens_shows(
    client: AsyncClient, db: AsyncSession
) -> None:
    """Only the target's OWN rows are found by the database's comparison (the
    unique key's). What a well inherits is read the way the lens draws it — the
    reads key field projects by their exact names — so the audit's old value is
    what the person saw, and an untick there is never a silent no-op."""
    pid = await _case_variant_campaign(client, db)
    assert (await _put(client, pid, "PO", {"well_project": FP}, "Completed")).status_code == 200
    project = {"scope": "project", "well_project": FP}
    assert (await _apply(client, pid, project, {"NAV": False})).status_code == 200
    w9 = _well("W-9", FP_UPPER)
    lens = (await client.get(f"/api/projects/{pid}/readiness/teams/logistics")).json()
    shown = next(r for r in lens["well_rows"] if r["well_name"] == "W-9")["checks"]
    assert (shown["PO"]["status"], shown["NAV"]["applies"]) == ("On Track", True)

    assert (await _put(client, pid, "PO", w9, "Completed")).status_code == 200
    assert (await _details(db, pid, "readiness_updated"))[-1] == (
        f"PO for W-9 ({FP_UPPER}, {ACT}): On Track -> Completed"
    )

    r = await _apply(client, pid, w9, {"NAV": False})
    assert r.status_code == 200, r.text
    after = next(row for row in r.json()["well_rows"] if row["well_name"] == "W-9")["checks"]
    assert (after["NAV"]["applies"], after["NAV"]["applies_source"]) == (False, "well")
    assert (await _details(db, pid))[-1] == (
        f"NAV: follows field project -> does not apply; for W-9 ({FP_UPPER}, {ACT})"
    )


# ── Backstop: an insert that still hits the unique key is a 409, not a 500 ──


async def _lookup_misses(*_args: object, **_kwargs: object) -> EntryIndex:
    """A target lookup that finds no stored row — as the exact-case dicts did."""
    return EntryIndex()


@pytest.mark.asyncio
async def test_a_status_write_hitting_the_unique_key_is_409_and_writes_nothing(
    client: AsyncClient, db: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    pid = await _case_variant_campaign(client, db)
    assert (await _put(client, pid, "FDP", {"well_project": FP}, "Completed")).status_code == 200
    audited = await _details(db, pid, "readiness_updated")

    monkeypatch.setattr("app.routers.readiness.load_target_index", _lookup_misses)
    r = await _put(client, pid, "FDP", {"well_project": FP_UPPER}, "Behind")
    assert r.status_code == 409
    assert r.json()["detail"] == "This readiness value changed while saving — reload and try again"
    assert FP not in r.text and "UNIQUE" not in r.text  # nothing internal leaks
    assert await _entries(db, pid, "FDP") == [("project", FP, "", "Completed")]
    assert await _details(db, pid, "readiness_updated") == audited
    # Rolled back cleanly: the session still serves the next request.
    assert (await client.get(f"/api/projects/{pid}/readiness")).status_code == 200


@pytest.mark.asyncio
async def test_a_tick_hitting_the_unique_key_is_409_and_writes_nothing(
    client: AsyncClient, db: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    pid = await _case_variant_campaign(client, db)
    project = {"scope": "project", "well_project": FP}
    assert (await _apply(client, pid, project, {"NAV": False})).status_code == 200

    monkeypatch.setattr("app.routers.readiness.load_target_index", _lookup_misses)
    upper = {"scope": "project", "well_project": FP_UPPER}
    r = await _apply(client, pid, upper, {"NAV": False, "PO": False})
    assert r.status_code == 409
    assert r.json()["detail"] == "This readiness value changed while saving — reload and try again"
    # All or nothing: PO's row and both events went with the rollback.
    rows = await _applicability(db, pid)
    assert [(a.check_code, a.well_project, a.applies) for a in rows] == [("NAV", FP, False)]
    assert await _details(db, pid) == [f"NAV: applies -> does not apply; for {FP}"]
    assert (await client.get(f"/api/projects/{pid}/readiness/teams/logistics")).status_code == 200
