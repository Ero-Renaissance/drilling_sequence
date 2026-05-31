"""Read-only per-project dashboard KPIs (docs/project-dashboard-spec.md)."""
from datetime import date, timedelta

import pytest
from httpx import AsyncClient

TODAY = date.today()


def _iso(d: date) -> str:
    return d.isoformat()


async def _project(client: AsyncClient, name: str = "Dash") -> str:
    return (await client.post("/api/projects", json={"name": name})).json()["id"]


async def _activity(
    client: AsyncClient,
    pid: str,
    *,
    rig: str,
    start: date,
    end: date,
    risk: str | None = None,
) -> dict:
    r = await client.post(
        f"/api/projects/{pid}/activities",
        json={
            "activity_type": "Oil Development",
            "start_date": _iso(start),
            "end_date": _iso(end),
            "rig_name": rig,
            "well_name": "W",
            "risk": risk,
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


@pytest.mark.asyncio
async def test_dashboard_denied_for_non_member(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    pid = await _project(client)
    # The other user is not a member of the project → BOLA scoping denies the read.
    assert (await other_client.get(f"/api/projects/{pid}/dashboard")).status_code == 403


@pytest.mark.asyncio
async def test_dashboard_empty_project(client: AsyncClient) -> None:
    pid = await _project(client, "Empty")
    r = await client.get(f"/api/projects/{pid}/dashboard")
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["activities"]["total"] == 0
    assert d["readiness"]["overall_pct"] is None  # no divide-by-zero
    assert d["approval"]["current_status"] == "draft"
    assert d["watchlist"]["overdue"] == 0


@pytest.mark.asyncio
async def test_dashboard_counts(client: AsyncClient) -> None:
    pid = await _project(client, "Counts")
    # overdue (past, not completed), High risk
    await _activity(
        client, pid, rig="R1", start=TODAY - timedelta(days=60), end=TODAY - timedelta(days=10), risk="High"
    )
    # near-term, no readiness → starting_soon + near_term_not_ready; High risk
    await _activity(
        client, pid, rig="R2", start=TODAY + timedelta(days=20), end=TODAY + timedelta(days=50), risk="High"
    )
    # far-future → ignored by near-term metrics
    await _activity(client, pid, rig="R3", start=TODAY + timedelta(days=400), end=TODAY + timedelta(days=450))
    # completed → completed_this_quarter, excluded from near-term
    d4 = await _activity(client, pid, rig="R4", start=TODAY + timedelta(days=5), end=TODAY + timedelta(days=15))
    await client.post(f"/api/projects/{pid}/activities/{d4['id']}/complete")
    # overlapping pair on the same rig → 1 conflict (creation isn't blocked; only submission is)
    await _activity(client, pid, rig="R5", start=TODAY + timedelta(days=100), end=TODAY + timedelta(days=200))
    await _activity(client, pid, rig="R5", start=TODAY + timedelta(days=150), end=TODAY + timedelta(days=250))

    d = (await client.get(f"/api/projects/{pid}/dashboard")).json()

    assert d["activities"]["total"] == 6
    assert d["activities"]["completed_this_quarter"] == 1
    assert d["activities"]["overdue"] == 1
    assert d["activities"]["starting_soon"] == 1  # only R2 (R4 completed)
    assert d["rigs"]["conflicts"] == 1
    assert d["risk"]["high"] == 2
    assert d["risk"]["high_near_term"] == 1  # R2 (R1 is past, not near-term)
    assert d["watchlist"]["near_term_not_ready"] == 1
    assert d["watchlist"]["overdue"] == 1
    assert d["approval"]["current_status"] == "draft"
    assert d["approval"]["drift_since_approved"] is None


@pytest.mark.asyncio
async def test_dashboard_readiness_pct(client: AsyncClient) -> None:
    pid = await _project(client, "Ready")
    a = await _activity(client, pid, rig="R", start=TODAY + timedelta(days=10), end=TODAY + timedelta(days=20))
    # one applicable gate, Completed → 100%, and the activity counts as ready
    await client.put(
        f"/api/projects/{pid}/activities/{a['id']}/readiness/BUD", json={"status": "Completed"}
    )
    d = (await client.get(f"/api/projects/{pid}/dashboard")).json()
    assert d["readiness"]["overall_pct"] == 100
    assert d["readiness"]["ready"] == 1
    assert d["watchlist"]["near_term_not_ready"] == 0
