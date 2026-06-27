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
    # CON is derived from the rig contract — give R a Completed contract that
    # covers the activity so the contract gate also reads Completed. With BUD +
    # CON both Completed (and the rest N/A-or-default), readiness is 100%.
    await client.put(
        f"/api/projects/{pid}/contracts/R",
        json={"status": "Completed", "contract_end": (TODAY + timedelta(days=60)).isoformat()},
    )
    d = (await client.get(f"/api/projects/{pid}/dashboard")).json()
    assert d["readiness"]["overall_pct"] == 100
    assert d["readiness"]["ready"] == 1
    assert d["watchlist"]["near_term_not_ready"] == 0

    # Phase-2 breakdowns: 8 gates; BUD and the derived CON both Completed.
    by_gate = {g["code"]: g for g in d["readiness"]["by_gate"]}
    assert len(by_gate) == 8
    assert by_gate["BUD"]["completed"] == 1
    assert by_gate["CON"]["completed"] == 1  # derived from the covering contract
    assert by_gate["LLI"]["not_started"] == 1  # unset gate reads as Not Started
    assert d["activities"]["by_activity_type"]["Oil Development"] == 1


@pytest.mark.asyncio
async def test_dashboard_con_gate_derived_from_contract(client: AsyncClient) -> None:
    """The CON gate is derived from the rig contract (not a stored row): a
    Completed contract whose end date doesn't cover the activity reads as Behind,
    and that flows into the dashboard breakdown + behind_cells."""
    pid = await _project(client, "Con")
    await _activity(
        client, pid, rig="R", start=TODAY + timedelta(days=5), end=TODAY + timedelta(days=40)
    )
    # Contract ends before the activity does → doesn't cover → CON = Behind.
    await client.put(
        f"/api/projects/{pid}/contracts/R",
        json={"status": "Completed", "contract_end": (TODAY + timedelta(days=20)).isoformat()},
    )
    d = (await client.get(f"/api/projects/{pid}/dashboard")).json()
    by_gate = {g["code"]: g for g in d["readiness"]["by_gate"]}
    assert by_gate["CON"]["behind"] == 1
    assert by_gate["CON"]["not_started"] == 0  # derived, not the stale default
    assert d["readiness"]["behind_cells"] == 1
