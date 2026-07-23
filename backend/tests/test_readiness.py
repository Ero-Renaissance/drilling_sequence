"""Per-FIELD-PROJECT readiness: gates live on the well_project (the "Project"
column), shared by every activity under it — not on individual activities."""
import pytest
from httpx import AsyncClient


async def _create_project(client: AsyncClient, name: str = "Test Campaign") -> dict:
    resp = await client.post("/api/projects", json={"name": name})
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _create_activity(client: AsyncClient, project_id: str, **overrides) -> dict:
    payload = {
        "activity_type": "Oil Development",
        "start_date": "2026-01-01",
        "end_date": "2026-03-31",
        "well_name": "Well-A1",
        "rig_name": "Rig Alpha",
        "location": "OFFSHORE",
        "plan_type": "Firm",
        "risk": "No Flood Risk",
        "well_project": "Bonga Phase 3",
        **overrides,
    }
    resp = await client.post(f"/api/projects/{project_id}/activities", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _url(project_id: str, well_project: str, code: str) -> str:
    return f"/api/projects/{project_id}/readiness/{well_project}/{code}"


# ── GET /readiness ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_readiness_empty_project(client: AsyncClient) -> None:
    project = await _create_project(client)
    resp = await client.get(f"/api/projects/{project['id']}/readiness")
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_activities_without_project_have_no_gates(client: AsyncClient) -> None:
    """Gates are field-project attributes — an activity with no Project value
    has nothing to attach them to and is omitted from the readiness view."""
    project = await _create_project(client)
    await _create_activity(client, project["id"], well_project=None)
    resp = await client.get(f"/api/projects/{project['id']}/readiness")
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_readiness_one_row_per_field_project(client: AsyncClient) -> None:
    """Several activities under one field project = ONE readiness entry (with
    the activity count); a second project gets its own entry."""
    project = await _create_project(client)
    await _create_activity(client, project["id"], well_name="W-1")
    await _create_activity(client, project["id"], well_name="W-2",
                           start_date="2026-04-01", end_date="2026-05-01")
    await _create_activity(client, project["id"], well_name="W-3",
                           well_project="Egina North", rig_name="Rig Beta",
                           start_date="2026-06-01", end_date="2026-07-01")

    rows = (await client.get(f"/api/projects/{project['id']}/readiness")).json()
    assert [(r["well_project"], r["activity_count"]) for r in rows] == [
        ("Bonga Phase 3", 2),
        ("Egina North", 1),
    ]
    # Defaults: every gate On Track.
    for row in rows:
        assert all(c["status"] == "On Track" for c in row["checks"].values())
        assert set(row["checks"].keys()) == {"FDP", "LLI", "LOC", "FE", "FID", "EIA", "BUD"}


@pytest.mark.asyncio
async def test_readiness_focus_start_tracks_earliest_pending_activity(client: AsyncClient) -> None:
    """focus_start is the earliest start of a NOT-done, readiness-REQUIRED activity
    under the field project — the signal the readiness page uses to replicate the
    Overview KPI's "next N months" window. It advances as work completes, and is
    null for a project with no pending readiness-required work."""
    project = await _create_project(client)
    # Bonga Phase 3: two pending activities — the earlier start wins.
    await _create_activity(client, project["id"], well_name="W-1",
                           start_date="2026-04-01", end_date="2026-05-01")
    early = await _create_activity(client, project["id"], well_name="W-2",
                                   start_date="2026-01-01", end_date="2026-02-01")
    # Egina North: only an opt-out activity (readiness_required=False) — no pending
    # readiness work, so it never falls inside a focus window.
    await _create_activity(client, project["id"], well_name="W-3",
                           well_project="Egina North", rig_name="Rig Beta",
                           start_date="2026-03-01", end_date="2026-04-01",
                           readiness_required=False)

    rows = (await client.get(f"/api/projects/{project['id']}/readiness")).json()
    by_project = {r["well_project"]: r for r in rows}
    assert by_project["Bonga Phase 3"]["focus_start"] == "2026-01-01"
    assert by_project["Egina North"]["focus_start"] is None

    # Completing the earliest activity advances the window to the next pending one.
    await client.post(f"/api/projects/{project['id']}/activities/{early['id']}/complete")
    rows = (await client.get(f"/api/projects/{project['id']}/readiness")).json()
    by_project = {r["well_project"]: r for r in rows}
    assert by_project["Bonga Phase 3"]["focus_start"] == "2026-04-01"


# ── PUT /readiness/{well_project}/{check_code} ───────────────────────────────


@pytest.mark.asyncio
async def test_upsert_gate_shared_by_all_project_activities(client: AsyncClient) -> None:
    project = await _create_project(client)
    await _create_activity(client, project["id"], well_name="W-1")
    await _create_activity(client, project["id"], well_name="W-2",
                           start_date="2026-04-01", end_date="2026-05-01")

    resp = await client.put(
        _url(project["id"], "Bonga Phase 3", "FID"),
        json={"status": "Completed", "notes": "Sanctioned at Q2 board"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["well_project"] == "Bonga Phase 3"
    assert body["check_code"] == "FID"
    assert body["status"] == "Completed"

    # The ONE project entry reflects it — there is no per-activity copy.
    rows = (await client.get(f"/api/projects/{project['id']}/readiness")).json()
    assert len(rows) == 1
    assert rows[0]["checks"]["FID"]["status"] == "Completed"
    assert rows[0]["checks"]["FID"]["notes"] == "Sanctioned at Q2 board"


@pytest.mark.asyncio
async def test_upsert_updates_existing_gate(client: AsyncClient) -> None:
    project = await _create_project(client)
    await _create_activity(client, project["id"])
    url = _url(project["id"], "Bonga Phase 3", "BUD")
    assert (await client.put(url, json={"status": "Behind"})).status_code == 200
    assert (await client.put(url, json={"status": "Completed"})).status_code == 200
    rows = (await client.get(f"/api/projects/{project['id']}/readiness")).json()
    assert rows[0]["checks"]["BUD"]["status"] == "Completed"


@pytest.mark.asyncio
async def test_upsert_gate_well_project_with_slash(client: AsyncClient) -> None:
    """Real well_project values carry slashes (e.g. the block "Gbaran 31/30").
    The PUT route uses a ``:path`` converter so the decoded slash doesn't split
    routing into a 404 — regression guard for the encoded-slash bug."""
    project = await _create_project(client)
    await _create_activity(client, project["id"], well_project="Gbaran 31/30")

    resp = await client.put(
        _url(project["id"], "Gbaran 31/30", "LLI"),
        json={"status": "Completed"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["well_project"] == "Gbaran 31/30"
    assert body["check_code"] == "LLI"

    rows = (await client.get(f"/api/projects/{project['id']}/readiness")).json()
    assert len(rows) == 1
    assert rows[0]["well_project"] == "Gbaran 31/30"
    assert rows[0]["checks"]["LLI"]["status"] == "Completed"


@pytest.mark.asyncio
async def test_upsert_unknown_project_404s(client: AsyncClient) -> None:
    """BOLA: gates can only be set for a field project that has activities in
    THIS campaign — no inventing readiness rows for arbitrary names."""
    project = await _create_project(client)
    await _create_activity(client, project["id"])
    resp = await client.put(
        _url(project["id"], "No Such Project", "FID"), json={"status": "Completed"}
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_upsert_invalid_check_code(client: AsyncClient) -> None:
    project = await _create_project(client)
    await _create_activity(client, project["id"])
    resp = await client.put(
        _url(project["id"], "Bonga Phase 3", "CON"), json={"status": "Completed"}
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_upsert_rejects_retired_status(client: AsyncClient) -> None:
    project = await _create_project(client)
    await _create_activity(client, project["id"])
    resp = await client.put(
        _url(project["id"], "Bonga Phase 3", "FID"), json={"status": "Delayed"}
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_readiness_write_requires_planner(
    client: AsyncClient, noplan_client: AsyncClient
) -> None:
    project = await _create_project(client)
    await _create_activity(client, project["id"])
    # Org-wide read stays open…
    assert (
        await noplan_client.get(f"/api/projects/{project['id']}/readiness")
    ).status_code == 200
    # …but a non-planner cannot set gates.
    resp = await noplan_client.put(
        _url(project["id"], "Bonga Phase 3", "FID"), json={"status": "Completed"}
    )
    assert resp.status_code == 403
