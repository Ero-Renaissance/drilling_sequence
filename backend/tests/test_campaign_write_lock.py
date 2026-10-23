"""Every plan write takes the campaign write lock before it reads what it decides
on (app/core/locks.py::lock_campaign_writes), so two writes in one campaign can't
interleave between one's checks and its writes.

SQLite can't show two transactions racing (the real-engine check lives in
test_concurrency_mssql.py); here we prove the ORDER: the campaign row's no-op
UPDATE is issued before the first statement that touches the plan's activities.
"""
import io
from collections.abc import Callable

import pytest
from httpx import AsyncClient
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User

_LOCK = "UPDATE projects SET name=projects.name"


async def _campaign(client: AsyncClient) -> str:
    return (await client.post("/api/projects", json={"name": "Lock Test"})).json()["id"]


async def _activity(client: AsyncClient, pid: str) -> dict:
    r = await client.post(
        f"/api/projects/{pid}/activities",
        json={
            "activity_type": "Oil Development",
            "start_date": "2027-01-01",
            "end_date": "2027-03-01",
            "well_name": "W-1",
            "rig_name": "Rig A",
            "location": "SWAMP",
            "plan_type": "Firm",
            "risk": "No Flood Risk",
            "well_project": "Bonga",
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


def _edit_body(a: dict) -> dict:
    return {
        "well_project": "Bonga",
        "new_name": "Bonga B",
        "dry_run": False,
        "wells": [{
            "id": a["id"], "expected_updated_at": a["updated_at"], "well_name": "W-1",
            "activity_type": a["activity_type"], "resource_type": "rig", "resource_name": "Rig A",
            "start_date": a["start_date"], "end_date": a["end_date"],
        }],
    }


CSV = (
    "Activity Type,Start Date,End Date,Well Name,Rig Name,Location\n"
    "Oil Well Drilling,2026-01-01,2026-03-31,Well-A1,Rig Alpha,OFFSHORE\n"
)

WRITES: dict[str, Callable] = {
    "create": lambda c, pid, a: c.post(f"/api/projects/{pid}/activities", json={
        "activity_type": "Oil Development", "start_date": "2027-05-01", "end_date": "2027-06-01",
        "well_name": "W-2", "location": "SWAMP", "plan_type": "Firm", "risk": "No Flood Risk",
    }),
    "edit": lambda c, pid, a: c.patch(
        f"/api/projects/{pid}/activities/{a['id']}", json={"comment": "x"}
    ),
    "complete": lambda c, pid, a: c.post(f"/api/projects/{pid}/activities/{a['id']}/complete"),
    "delete": lambda c, pid, a: c.delete(f"/api/projects/{pid}/activities/{a['id']}"),
    "add project wells": lambda c, pid, a: c.post(
        f"/api/projects/{pid}/activities/project-wells",
        json={
            "well_project": "Egina", "start_date": "2028-01-01", "location": "SWAMP",
            "plan_type": "Firm", "risk": "No Flood Risk", "dry_run": False,
            "wells": [{"well_name": "E-1", "activity_type": "Oil Development",
                       "resource_type": "none", "duration_months": 1}],
        },
    ),
    "edit project wells": lambda c, pid, a: c.put(
        f"/api/projects/{pid}/activities/project-wells", json=_edit_body(a)
    ),
    "import": lambda c, pid, a: c.post(
        f"/api/projects/{pid}/activities/import",
        files={"file": ("a.csv", io.BytesIO(CSV.encode()), "text/csv")},
    ),
    "submit revision": lambda c, pid, a: c.post(f"/api/projects/{pid}/revisions", json={}),
}


@pytest.mark.asyncio
@pytest.mark.parametrize("name", list(WRITES))
async def test_plan_writes_lock_the_campaign_first(
    client: AsyncClient, db: AsyncSession, name: str
) -> None:
    pid = await _campaign(client)
    a = await _activity(client, pid)

    statements: list[str] = []

    def capture(conn, cursor, statement, parameters, context, executemany) -> None:  # noqa: ANN001
        statements.append(" ".join(statement.split()))

    engine = db.bind.sync_engine  # type: ignore[union-attr]
    event.listen(engine, "before_cursor_execute", capture)
    try:
        r = await WRITES[name](client, pid, a)
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    assert r.status_code < 300, r.text

    lock_at = next((i for i, s in enumerate(statements) if s.startswith(_LOCK)), None)
    assert lock_at is not None, f"{name} never locked the campaign"
    first_plan_read = next(i for i, s in enumerate(statements) if "activities" in s)
    assert lock_at < first_plan_read, f"{name} read the plan before locking the campaign"


@pytest.mark.asyncio
async def test_an_import_preview_takes_no_lock(client: AsyncClient, db: AsyncSession) -> None:
    pid = await _campaign(client)
    statements: list[str] = []

    def capture(conn, cursor, statement, parameters, context, executemany) -> None:  # noqa: ANN001
        statements.append(statement)

    engine = db.bind.sync_engine  # type: ignore[union-attr]
    event.listen(engine, "before_cursor_execute", capture)
    try:
        r = await client.post(
            f"/api/projects/{pid}/activities/import?dry_run=true",
            files={"file": ("a.csv", io.BytesIO(CSV.encode()), "text/csv")},
        )
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    assert r.status_code == 200, r.text
    assert not any(" ".join(s.split()).startswith(_LOCK) for s in statements)


# ── Readiness writes (phase 6, spec §5.2) ───────────────────────────────────
# Every readiness write — a status, Reset to project, which checks apply — takes
# the same lock right after its authorization check, before it reads the target
# (BOLA), its stored values or the plan lock. That closes a Project-gate write
# committing between a submit's snapshot and its lock, and two first writes to
# one target colliding on the unique key.

_WELL = {
    "scope": "well", "well_project": "Bonga", "well_name": "W-1",
    "activity_type": "Oil Development",
}

READINESS_WRITES: dict[str, Callable] = {
    "project gate status": lambda c, pid: c.put(
        f"/api/projects/{pid}/readiness/FID", json={"well_project": "Bonga", "status": "Behind"}
    ),
    "team check status": lambda c, pid: c.put(
        f"/api/projects/{pid}/readiness/L-BUD", json={**_WELL, "status": "Behind"}
    ),
    "reset to project": lambda c, pid: c.post(f"/api/projects/{pid}/readiness/L-BUD/reset", json=_WELL),
    "applicability": lambda c, pid: c.put(
        f"/api/projects/{pid}/readiness/teams/logistics/applicability",
        json={"well_project": "Bonga", "applies": {"L-BUD": False}},
    ),
}

# What a readiness write decides on: the plan (the target exists? locked?) and
# the campaign's stored readiness.
_CAMPAIGN_READS = ("activities", "readiness_entries", "readiness_applicability")


@pytest.mark.asyncio
@pytest.mark.parametrize("name", list(READINESS_WRITES))
async def test_readiness_writes_lock_the_campaign_first(
    client: AsyncClient, db: AsyncSession, name: str
) -> None:
    # As admin: the Logistics team and a check enabled at both levels.
    await client.get("/api/projects")
    me = (await db.execute(select(User).where(User.email == "test@company.com"))).scalar_one()
    me.is_admin = True
    await db.commit()
    assert (
        await client.post(
            "/api/admin/readiness/teams",
            json={"code": "logistics", "name": "Logistics", "icon_key": "truck"},
        )
    ).status_code == 201
    assert (
        await client.post(
            "/api/admin/readiness/checks",
            json={
                "code": "L-BUD", "label": "Budget Availability", "team_code": "logistics",
                "applies_project": True, "applies_well": True, "status_set": "standard",
                "icon_key": "banknote", "locks_with_plan": False,
            },
        )
    ).status_code == 201
    pid = await _campaign(client)
    await _activity(client, pid)
    # A well override, so Reset to project has something to remove.
    r = await client.put(f"/api/projects/{pid}/readiness/L-BUD", json={**_WELL, "status": "Completed"})
    assert r.status_code == 200, r.text

    statements: list[str] = []

    def capture(conn, cursor, statement, parameters, context, executemany) -> None:  # noqa: ANN001
        statements.append(" ".join(statement.split()))

    engine = db.bind.sync_engine  # type: ignore[union-attr]
    event.listen(engine, "before_cursor_execute", capture)
    try:
        r = await READINESS_WRITES[name](client, pid)
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    assert r.status_code < 300, r.text

    lock_at = next((i for i, s in enumerate(statements) if s.startswith(_LOCK)), None)
    assert lock_at is not None, f"{name} never locked the campaign"
    first_read = next(
        i for i, s in enumerate(statements) if any(t in s for t in _CAMPAIGN_READS)
    )
    assert lock_at < first_read, f"{name} read the campaign before locking it"


@pytest.mark.asyncio
async def test_a_refused_readiness_write_takes_no_lock(
    client: AsyncClient, noplan_client: AsyncClient, db: AsyncSession
) -> None:
    """Authorization comes first: a caller who may not write never queues on (or
    takes) the campaign lock."""
    pid = await _campaign(client)
    await _activity(client, pid)
    statements: list[str] = []

    def capture(conn, cursor, statement, parameters, context, executemany) -> None:  # noqa: ANN001
        statements.append(" ".join(statement.split()))

    engine = db.bind.sync_engine  # type: ignore[union-attr]
    event.listen(engine, "before_cursor_execute", capture)
    try:
        r = await READINESS_WRITES["project gate status"](noplan_client, pid)
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    assert r.status_code == 403
    assert not any(s.startswith(_LOCK) for s in statements)
