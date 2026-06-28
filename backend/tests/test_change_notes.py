"""Per-resource change notes: CRUD, validation, planner-only, lock-guarded, and
captured into the revision snapshot on submit."""
import json
import uuid

from httpx import AsyncClient


async def _project(client: AsyncClient) -> str:
    project = (await client.post("/api/projects", json={"name": "Notes Test"})).json()
    await client.post(
        f"/api/projects/{project['id']}/activities",
        json={
            "activity_type": "Oil Well Drilling",
            "start_date": "2026-01-01",
            "end_date": "2026-02-01",
            "well_name": "Well-1",
            "location": "OFFSHORE",
            "plan_type": "Firm",
            "risk": "No Flood Risk",
        },
    )
    return project["id"]


async def test_upsert_and_list(client: AsyncClient) -> None:
    pid = await _project(client)
    base = f"/api/projects/{pid}/change-notes"
    r = await client.put(
        base, json={"kind": "rig", "resource_name": "RigAlpha", "body": "Spud moved to Jul (vs May)."}
    )
    assert r.status_code == 200, r.text
    assert r.json()["body"].startswith("Spud moved")

    listed = (await client.get(base)).json()
    assert any(n["kind"] == "rig" and n["resource_name"] == "RigAlpha" for n in listed)


async def test_upsert_replaces_existing(client: AsyncClient) -> None:
    pid = await _project(client)
    base = f"/api/projects/{pid}/change-notes"
    await client.put(base, json={"kind": "rig", "resource_name": "RigAlpha", "body": "first"})
    await client.put(base, json={"kind": "rig", "resource_name": "RigAlpha", "body": "second"})
    rig = [n for n in (await client.get(base)).json() if n["resource_name"] == "RigAlpha"]
    assert len(rig) == 1 and rig[0]["body"] == "second"


async def test_general_note_has_no_resource(client: AsyncClient) -> None:
    pid = await _project(client)
    r = await client.put(
        f"/api/projects/{pid}/change-notes", json={"kind": "general", "body": "Whole-campaign note."}
    )
    assert r.status_code == 200
    assert r.json()["resource_name"] is None


async def test_empty_body_deletes(client: AsyncClient) -> None:
    pid = await _project(client)
    base = f"/api/projects/{pid}/change-notes"
    await client.put(base, json={"kind": "rig", "resource_name": "RigAlpha", "body": "x"})
    r = await client.put(base, json={"kind": "rig", "resource_name": "RigAlpha", "body": "   "})
    assert r.status_code == 200 and r.json() is None
    assert (await client.get(base)).json() == []


async def test_validation(client: AsyncClient) -> None:
    pid = await _project(client)
    base = f"/api/projects/{pid}/change-notes"
    assert (await client.put(base, json={"kind": "rig", "body": "x"})).status_code == 422
    assert (
        await client.put(base, json={"kind": "fleet", "resource_name": "A", "body": "x"})
    ).status_code == 422
    assert (
        await client.put(base, json={"kind": "rig", "resource_name": "A", "body": "x" * 4001})
    ).status_code == 422


async def test_planner_only(client: AsyncClient, other_client: AsyncClient) -> None:
    pid = await _project(client)
    await client.post(
        f"/api/projects/{pid}/approvers",
        json={"email": "other@company.com", "role_label": "Approver"},
    )
    # other@ is a designated approver but not a project member → cannot author notes.
    r = await other_client.put(
        f"/api/projects/{pid}/change-notes", json={"kind": "rig", "resource_name": "A", "body": "x"}
    )
    assert r.status_code in (403, 404)


async def test_locked_while_revision_pending(client: AsyncClient) -> None:
    pid = await _project(client)
    await client.post(f"/api/projects/{pid}/revisions", json={})  # locks the plan
    r = await client.put(
        f"/api/projects/{pid}/change-notes", json={"kind": "rig", "resource_name": "A", "body": "x"}
    )
    assert r.status_code == 423


async def test_snapshotted_into_revision(client: AsyncClient, db) -> None:
    pid = await _project(client)
    await client.put(
        f"/api/projects/{pid}/change-notes",
        json={"kind": "rig", "resource_name": "RigAlpha", "body": "Spud moved to Jul."},
    )
    rev = await client.post(f"/api/projects/{pid}/revisions", json={})
    assert rev.status_code in (200, 201), rev.text

    from app.models.revision import Revision

    revision = await db.get(Revision, uuid.UUID(rev.json()["id"]))
    notes = json.loads(revision.change_notes_json)
    assert any(n["resource_name"] == "RigAlpha" and "Spud moved" in n["body"] for n in notes)


async def test_revision_detail_exposes_change_notes(client: AsyncClient) -> None:
    """The frozen notes are surfaced read-only on the revision-detail response."""
    pid = await _project(client)
    await client.put(
        f"/api/projects/{pid}/change-notes",
        json={"kind": "rig", "resource_name": "RigAlpha", "body": "Spud moved to Jul."},
    )
    rev = await client.post(f"/api/projects/{pid}/revisions", json={})

    detail = await client.get(f"/api/projects/{pid}/revisions/{rev.json()['id']}")
    assert detail.status_code == 200, detail.text
    notes = detail.json()["change_notes"]
    assert any(
        n["kind"] == "rig" and n["resource_name"] == "RigAlpha" and "Spud moved" in n["body"]
        for n in notes
    )


async def test_revision_detail_change_notes_empty_when_none(client: AsyncClient) -> None:
    """A revision submitted with no notes reports an empty list, never null."""
    pid = await _project(client)
    rev = await client.post(f"/api/projects/{pid}/revisions", json={})
    detail = await client.get(f"/api/projects/{pid}/revisions/{rev.json()['id']}")
    assert detail.status_code == 200
    assert detail.json()["change_notes"] == []
