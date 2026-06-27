import pytest
from httpx import AsyncClient


async def _create_project(client: AsyncClient, name: str = "Test Project") -> dict:
    resp = await client.post("/api/projects", json={"name": name})
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _create_activity(client: AsyncClient, project_id: str, **overrides) -> dict:
    payload = {
        "activity_type": "Oil Well Drilling",
        "start_date": "2026-01-01",
        "end_date": "2026-03-31",
        "well_name": "Well-A1",
        "rig_name": "Rig Alpha",
        "location": "OFFSHORE",
        "plan_type": "Firm",
        "risk": "No Flood Risk",
        **overrides,
    }
    resp = await client.post(f"/api/projects/{project_id}/activities", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


# ── GET /readiness ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_readiness_empty_project(client: AsyncClient) -> None:
    project = await _create_project(client)
    resp = await client.get(f"/api/projects/{project['id']}/readiness")
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_readiness_all_on_track_by_default(client: AsyncClient) -> None:
    project = await _create_project(client)
    activity = await _create_activity(client, project["id"])

    resp = await client.get(f"/api/projects/{project['id']}/readiness")
    assert resp.status_code == 200
    rows = resp.json()
    assert len(rows) == 1

    row = rows[0]
    assert row["activity_id"] == activity["id"]
    assert row["activity_type"] == "Oil Well Drilling"
    assert row["well_name"] == "Well-A1"

    # All 8 codes present; unset gates (and the no-contract CON) default to "On Track".
    checks = row["checks"]
    assert set(checks.keys()) == {"FDP", "LLI", "LOC", "FE", "FID", "EIA", "BUD", "CON"}
    for code, state in checks.items():
        assert state["status"] == "On Track", f"{code} should default to On Track"


@pytest.mark.asyncio
async def test_readiness_returns_multiple_activities(client: AsyncClient) -> None:
    project = await _create_project(client)
    await _create_activity(client, project["id"], activity_type="Oil Development")
    await _create_activity(client, project["id"], activity_type="Gas Development",
                           start_date="2026-04-01", end_date="2026-06-30")

    resp = await client.get(f"/api/projects/{project['id']}/readiness")
    assert resp.status_code == 200
    assert len(resp.json()) == 2


# ── PUT /activities/{id}/readiness/{code} ───────────────────────────────────

@pytest.mark.asyncio
async def test_upsert_check_creates_record(client: AsyncClient) -> None:
    project = await _create_project(client)
    activity = await _create_activity(client, project["id"])

    resp = await client.put(
        f"/api/projects/{project['id']}/activities/{activity['id']}/readiness/BUD",
        json={"status": "Completed"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["check_code"] == "BUD"
    assert data["status"] == "Completed"
    assert data["notes"] is None


@pytest.mark.asyncio
async def test_upsert_check_updates_existing(client: AsyncClient) -> None:
    project = await _create_project(client)
    activity = await _create_activity(client, project["id"])
    url = f"/api/projects/{project['id']}/activities/{activity['id']}/readiness/LLI"

    await client.put(url, json={"status": "On Track"})
    resp = await client.put(url, json={"status": "Completed", "notes": "Approved by team"})

    assert resp.status_code == 200
    assert resp.json()["status"] == "Completed"
    assert resp.json()["notes"] == "Approved by team"


@pytest.mark.asyncio
async def test_upsert_check_reflects_in_get(client: AsyncClient) -> None:
    project = await _create_project(client)
    activity = await _create_activity(client, project["id"])

    await client.put(
        f"/api/projects/{project['id']}/activities/{activity['id']}/readiness/FID",
        json={"status": "Behind"},
    )

    resp = await client.get(f"/api/projects/{project['id']}/readiness")
    row = resp.json()[0]
    assert row["checks"]["FID"]["status"] == "Behind"
    assert row["checks"]["BUD"]["status"] == "On Track"  # unset → default


@pytest.mark.asyncio
async def test_upsert_invalid_check_code(client: AsyncClient) -> None:
    project = await _create_project(client)
    activity = await _create_activity(client, project["id"])

    resp = await client.put(
        f"/api/projects/{project['id']}/activities/{activity['id']}/readiness/BOGUS",
        json={"status": "Completed"},
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_upsert_rejects_retired_status(client: AsyncClient) -> None:
    """The status enum collapsed to On Track / Behind / Completed (+ N/A); the old
    'Not Started' / 'In Progress' values are no longer accepted."""
    project = await _create_project(client)
    activity = await _create_activity(client, project["id"])
    url = f"/api/projects/{project['id']}/activities/{activity['id']}/readiness/BUD"
    for retired in ("Not Started", "In Progress"):
        resp = await client.put(url, json={"status": retired})
        assert resp.status_code == 422, f"{retired} should be rejected"


@pytest.mark.asyncio
async def test_upsert_activity_not_in_project(client: AsyncClient) -> None:
    project_a = await _create_project(client, "Project A")
    project_b = await _create_project(client, "Project B")
    activity = await _create_activity(client, project_a["id"])

    resp = await client.put(
        f"/api/projects/{project_b['id']}/activities/{activity['id']}/readiness/BUD",
        json={"status": "Completed"},
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_readiness_requires_auth(client: AsyncClient, other_client: AsyncClient) -> None:
    project = await _create_project(client)
    activity = await _create_activity(client, project["id"])

    # other_client is not a member of the project
    resp = await other_client.get(f"/api/projects/{project['id']}/readiness")
    assert resp.status_code == 403

    resp = await other_client.put(
        f"/api/projects/{project['id']}/activities/{activity['id']}/readiness/BUD",
        json={"status": "Completed"},
    )
    assert resp.status_code == 403
