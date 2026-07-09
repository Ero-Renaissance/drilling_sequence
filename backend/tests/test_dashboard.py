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
    risk: str = "No Flood Risk",
) -> dict:
    r = await client.post(
        f"/api/projects/{pid}/activities",
        json={
            "activity_type": "Oil Development",
            "start_date": _iso(start),
            "end_date": _iso(end),
            "rig_name": rig,
            "well_name": "W",
            "location": "OFFSHORE",
            "plan_type": "Firm",
            "risk": risk,
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


@pytest.mark.asyncio
async def test_dashboard_open_to_any_authenticated_user(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    pid = await _project(client)
    # Reads are org-wide: any authenticated user may view the KPI dashboard.
    assert (await other_client.get(f"/api/projects/{pid}/dashboard")).status_code == 200


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
async def test_dashboard_excludes_readiness_not_required(client: AsyncClient) -> None:
    pid = await _project(client, "OptOut")
    # A near-term activity that opts OUT of readiness tracking.
    r = await client.post(
        f"/api/projects/{pid}/activities",
        json={
            "activity_type": "Oil Development",
            "start_date": _iso(TODAY + timedelta(days=10)),
            "end_date": _iso(TODAY + timedelta(days=40)),
            "rig_name": "R1",
            "well_name": "W",
            "location": "OFFSHORE",
            "plan_type": "Firm",
            "risk": "No Flood Risk",
            "readiness_required": False,
        },
    )
    assert r.status_code == 201, r.text

    d = (await client.get(f"/api/projects/{pid}/dashboard")).json()
    # Excluded from the readiness focus window and the not-ready nudge…
    assert d["readiness"]["focus_count"] == 0
    assert d["readiness"]["overall_pct"] is None
    assert d["watchlist"]["near_term_not_ready"] == 0
    # …but still a normal scheduled activity.
    assert d["activities"]["total"] == 1
    assert d["activities"]["starting_soon"] == 1


@pytest.mark.asyncio
async def test_dashboard_counts(client: AsyncClient) -> None:
    pid = await _project(client, "Counts")
    # overdue (past, not completed), Flood risk
    await _activity(
        client, pid, rig="R1", start=TODAY - timedelta(days=60), end=TODAY - timedelta(days=10), risk="Flood Risk"
    )
    # near-term, no readiness → starting_soon + near_term_not_ready; Flood risk
    await _activity(
        client, pid, rig="R2", start=TODAY + timedelta(days=20), end=TODAY + timedelta(days=50), risk="Flood Risk"
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
    assert d["activities"]["completed_ytd"] == 1
    assert d["activities"]["overdue"] == 1
    assert d["activities"]["starting_soon"] == 1  # only R2 (R4 completed)
    assert d["rigs"]["conflicts"] == 1
    assert d["risk"]["flood"] == 2
    assert d["risk"]["flood_near_term"] == 1  # R2 (R1 is past, not near-term)
    assert d["watchlist"]["near_term_not_ready"] == 1
    assert d["watchlist"]["overdue"] == 1
    assert d["approval"]["current_status"] == "draft"
    assert d["approval"]["drift_since_approved"] is None


@pytest.mark.asyncio
async def test_completed_ytd_spans_clone_lineage(client: AsyncClient) -> None:
    pid = await _project(client, "Q1")
    a = await _activity(client, pid, rig="R", start=TODAY - timedelta(days=20), end=TODAY - timedelta(days=5))
    await client.post(f"/api/projects/{pid}/activities/{a['id']}/complete")

    d1 = (await client.get(f"/api/projects/{pid}/dashboard")).json()
    assert d1["activities"]["completed_ytd"] == 1

    # The clone drops the completed activity, but YTD still counts it via lineage.
    clone = (await client.post(f"/api/projects/{pid}/clone", json={"name": "Q2"})).json()
    d2 = (await client.get(f"/api/projects/{clone['id']}/dashboard")).json()
    assert d2["activities"]["completed_this_quarter"] == 0
    assert d2["activities"]["completed_ytd"] == 1


@pytest.mark.asyncio
async def test_dashboard_readiness_pct(client: AsyncClient) -> None:
    pid = await _project(client, "Ready")
    a = await _activity(client, pid, rig="R", start=TODAY + timedelta(days=10), end=TODAY + timedelta(days=20))
    await client.put(
        f"/api/projects/{pid}/activities/{a['id']}/readiness/BUD", json={"status": "Completed"}
    )
    # BUD is the only stored gate and it's Completed → the activity is 100% ready.
    d = (await client.get(f"/api/projects/{pid}/dashboard")).json()
    assert d["readiness"]["overall_pct"] == 100
    assert d["readiness"]["ready"] == 1
    assert d["watchlist"]["near_term_not_ready"] == 0

    # Phase-2 breakdowns: 7 gates; BUD Completed, unset gates read as On Track.
    by_gate = {g["code"]: g for g in d["readiness"]["by_gate"]}
    assert len(by_gate) == 7
    assert by_gate["BUD"]["completed"] == 1
    assert by_gate["LLI"]["on_track"] == 1  # unset gate reads as On Track
    assert d["activities"]["by_activity_type"]["Oil Development"] == 1


@pytest.mark.asyncio
async def test_dashboard_contract_buckets_use_cadence_thresholds(client: AsyncClient) -> None:
    """Urgency tiers are keyed to the QUARTERLY approval cadence (kept in sync
    with frontend/src/lib/contract-urgency.ts): critical < 90 days (less than
    one approval cycle left), soon 90-179 days (two cycles), healthy >= 180."""
    pid = await _project(client, "Contracts")
    ends = {
        "R_EXPIRED": TODAY - timedelta(days=1),
        "R_CRITICAL_LOW": TODAY + timedelta(days=45),  # was 'soon' under the old 30/90
        "R_CRITICAL_HIGH": TODAY + timedelta(days=89),
        "R_SOON_LOW": TODAY + timedelta(days=90),
        "R_SOON_HIGH": TODAY + timedelta(days=179),  # was 'healthy' under the old 30/90
        "R_HEALTHY": TODAY + timedelta(days=180),
    }
    for rig, end in ends.items():
        r = await client.put(
            f"/api/projects/{pid}/contracts/{rig}",
            json={"contract_end": _iso(end), "status": "Completed"},
        )
        assert r.status_code == 200, r.text

    d = (await client.get(f"/api/projects/{pid}/dashboard")).json()
    assert d["contracts"]["expired"] == 1
    assert d["contracts"]["critical"] == 2
    assert d["contracts"]["soon"] == 2
    assert d["contracts"]["healthy"] == 1
    assert d["watchlist"]["contracts_expiring"] == 5
