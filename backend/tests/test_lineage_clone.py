"""Cross-project comparison: clone carries activity lineage, completed
activities drop out of the clone, and cross-compare matches Q1↔Q2 by lineage."""
import pytest
from httpx import AsyncClient


async def _project(client: AsyncClient, name: str) -> str:
    r = await client.post("/api/projects", json={"name": name})
    return r.json()["id"]


async def _activity(client: AsyncClient, project_id: str, **fields) -> dict:
    payload = {"activity_type": "Drilling", "start_date": "2026-01-01", "end_date": "2026-01-31"}
    payload.update(fields)
    r = await client.post(f"/api/projects/{project_id}/activities", json=payload)
    assert r.status_code == 201, r.text
    return r.json()


@pytest.mark.asyncio
async def test_complete_and_reopen(client: AsyncClient) -> None:
    pid = await _project(client, "Q1")
    act = await _activity(client, pid, well_name="W-1")

    done = await client.post(f"/api/projects/{pid}/activities/{act['id']}/complete")
    assert done.status_code == 200, done.text
    assert done.json()["completed_at"] is not None

    reopened = await client.post(f"/api/projects/{pid}/activities/{act['id']}/reopen")
    assert reopened.status_code == 200
    assert reopened.json()["completed_at"] is None


@pytest.mark.asyncio
async def test_clone_drops_completed_activities(client: AsyncClient) -> None:
    pid = await _project(client, "Q1")
    keep = await _activity(client, pid, well_name="W-keep")
    drop = await _activity(client, pid, well_name="W-done")
    await client.post(f"/api/projects/{pid}/activities/{drop['id']}/complete")

    clone = await client.post(f"/api/projects/{pid}/clone", json={"name": "Q2"})
    assert clone.status_code == 201, clone.text
    q2 = clone.json()["id"]

    acts = (await client.get(f"/api/projects/{q2}/activities")).json()
    wells = {a["well_name"] for a in acts}
    assert wells == {"W-keep"}
    assert keep["well_name"] == "W-keep"


@pytest.mark.asyncio
async def test_cross_compare_matches_by_lineage(client: AsyncClient) -> None:
    # Q1 with two wells; complete one so it drops from the clone.
    q1 = await _project(client, "Q1")
    a1 = await _activity(client, q1, well_name="W-1", rig_name="Rig A")
    a2 = await _activity(client, q1, well_name="W-2", rig_name="Rig B")
    await client.post(f"/api/projects/{q1}/activities/{a2['id']}/complete")

    # Clone into Q2 (drops W-2), then reassign W-1's rig in the new quarter.
    q2 = (await client.post(f"/api/projects/{q1}/clone", json={"name": "Q2"})).json()["id"]
    q2_acts = (await client.get(f"/api/projects/{q2}/activities")).json()
    w1_clone = next(a for a in q2_acts if a["well_name"] == "W-1")
    await client.patch(
        f"/api/projects/{q2}/activities/{w1_clone['id']}",
        json={"rig_name": "Rig C"},
    )

    r = await client.get(
        f"/api/projects/{q2}/revisions/cross-compare",
        params={"base_project_id": q1, "base": "live", "target": "live"},
    )
    assert r.status_code == 200, r.text
    data = r.json()
    s = data["summary"]
    # W-1 rig changed → modified; W-2 was completed/dropped → removed.
    assert s["modified"] == 1
    assert s["removed"] == 1
    assert s["added"] == 0

    by_change = {a["change"]: a for a in data["activities"]}
    rig_fields = {f["field"]: (f["old"], f["new"]) for f in by_change["modified"]["fields"]}
    assert rig_fields["Rig"] == ("Rig A", "Rig C")
    assert by_change["removed"]["well_name"] == "W-2"
    assert a1["well_name"] == "W-1"


@pytest.mark.asyncio
async def test_cross_compare_denied_for_non_member(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    q1 = await _project(client, "Q1")
    q2 = await _project(client, "Q2")
    r = await other_client.get(
        f"/api/projects/{q2}/revisions/cross-compare",
        params={"base_project_id": q1},
    )
    assert r.status_code == 403
