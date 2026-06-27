"""Server-side enforcement of the revision lock: while a revision is awaiting
approval its activities are frozen, so the plan can't change out from under the
approvers. The lock clears on approve / discard.
"""

import io

import pytest
from httpx import AsyncClient

CSV = "Activity Type,Start Date,End Date\nOil Well Drilling,2026-01-01,2026-02-01\n"


async def _project_with_activity(client: AsyncClient) -> tuple[str, str]:
    project = (await client.post("/api/projects", json={"name": "Lock Test"})).json()
    activity = (
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
    ).json()
    return project["id"], activity["id"]


async def _create_revision(client: AsyncClient, project_id: str) -> str:
    r = await client.post(f"/api/projects/{project_id}/revisions", json={})
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


@pytest.mark.asyncio
async def test_cannot_edit_complete_or_delete_locked_activity(client: AsyncClient) -> None:
    project_id, activity_id = await _project_with_activity(client)
    await _create_revision(client, project_id)  # locks the activity

    base = f"/api/projects/{project_id}/activities/{activity_id}"
    assert (await client.patch(base, json={"well_name": "Changed"})).status_code == 423
    assert (await client.post(f"{base}/complete")).status_code == 423
    assert (await client.delete(base)).status_code == 423


@pytest.mark.asyncio
async def test_cannot_import_while_revision_pending(client: AsyncClient) -> None:
    project_id, _ = await _project_with_activity(client)
    await _create_revision(client, project_id)

    r = await client.post(
        f"/api/projects/{project_id}/activities/import",
        files={"file": ("a.csv", io.BytesIO(CSV.encode()), "text/csv")},
    )
    assert r.status_code == 423


@pytest.mark.asyncio
async def test_cannot_create_activity_while_revision_pending(client: AsyncClient) -> None:
    """Adding an activity mutates the plan, so it is barred while a revision is
    pending — the live plan can't diverge from the snapshot under approval. It is
    allowed again once the revision is discarded."""
    project_id, _ = await _project_with_activity(client)
    revision_id = await _create_revision(client, project_id)

    new_activity = {
        "activity_type": "Oil Well Drilling",
        "start_date": "2026-03-01",
        "end_date": "2026-04-01",
        "well_name": "Well-2",
        "location": "OFFSHORE",
        "plan_type": "Firm",
        "risk": "No Flood Risk",
    }
    blocked = await client.post(
        f"/api/projects/{project_id}/activities", json=new_activity
    )
    assert blocked.status_code == 423

    discard = await client.delete(f"/api/projects/{project_id}/revisions/{revision_id}")
    assert discard.status_code == 204

    assert (
        await client.post(f"/api/projects/{project_id}/activities", json=new_activity)
    ).status_code == 201


@pytest.mark.asyncio
async def test_edit_allowed_after_revision_discarded(client: AsyncClient) -> None:
    project_id, activity_id = await _project_with_activity(client)
    revision_id = await _create_revision(client, project_id)

    base = f"/api/projects/{project_id}/activities/{activity_id}"
    assert (await client.patch(base, json={"well_name": "Nope"})).status_code == 423

    discard = await client.delete(f"/api/projects/{project_id}/revisions/{revision_id}")
    assert discard.status_code == 204

    ok = await client.patch(base, json={"well_name": "Now Editable"})
    assert ok.status_code == 200
    assert ok.json()["well_name"] == "Now Editable"


@pytest.mark.asyncio
async def test_readiness_upsert_locked_then_unlocked(client: AsyncClient) -> None:
    project_id, activity_id = await _project_with_activity(client)
    revision_id = await _create_revision(client, project_id)

    url = f"/api/projects/{project_id}/activities/{activity_id}/readiness/BUD"
    assert (await client.put(url, json={"status": "On Track"})).status_code == 423

    discard = await client.delete(f"/api/projects/{project_id}/revisions/{revision_id}")
    assert discard.status_code == 204

    assert (await client.put(url, json={"status": "On Track"})).status_code == 200


@pytest.mark.asyncio
async def test_readiness_list_reports_locked(client: AsyncClient) -> None:
    """The readiness list flags each row as locked while a revision is pending, so
    the grid can disable the dots up front; the flag clears once resolved."""
    project_id, _ = await _project_with_activity(client)
    revision_id = await _create_revision(client, project_id)

    locked = (await client.get(f"/api/projects/{project_id}/readiness")).json()
    assert locked and all(row["locked"] for row in locked)

    await client.delete(f"/api/projects/{project_id}/revisions/{revision_id}")
    unlocked = (await client.get(f"/api/projects/{project_id}/readiness")).json()
    assert unlocked and not any(row["locked"] for row in unlocked)


@pytest.mark.asyncio
async def test_contract_edit_locked_then_unlocked(client: AsyncClient) -> None:
    """Rig-contract edits drive derived CON readiness, so they're frozen while a
    revision is pending and allowed again once it's resolved."""
    project_id, _ = await _project_with_activity(client)
    revision_id = await _create_revision(client, project_id)

    url = f"/api/projects/{project_id}/contracts/RigAlpha"
    assert (await client.put(url, json={"status": "Not Started"})).status_code == 423

    discard = await client.delete(f"/api/projects/{project_id}/revisions/{revision_id}")
    assert discard.status_code == 204

    assert (await client.put(url, json={"status": "Not Started"})).status_code == 200


@pytest.mark.asyncio
async def test_approved_plan_frozen_until_revised(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    """Model B: approval FREEZES the plan (the snapshot is the record); a planner
    must Revise Plan (reopen) to edit it for the next cycle."""
    project_id, activity_id = await _project_with_activity(client)
    # other@ is the approver — the creator can't approve their own plan.
    await client.post(
        f"/api/projects/{project_id}/approvers",
        json={"email": "other@company.com", "role_label": "Approver"},
    )
    revision_id = await _create_revision(client, project_id)

    base = f"/api/projects/{project_id}/activities/{activity_id}"
    assert (await client.patch(base, json={"well_name": "Nope"})).status_code == 423

    signed = await other_client.put(
        f"/api/projects/{project_id}/revisions/{revision_id}/sign",
        json={"role_label": "Manager"},
    )
    assert signed.status_code == 200
    assert signed.json()["status"] == "approved"

    # Still frozen after approval — no silent edits to an approved plan.
    assert (await client.patch(base, json={"well_name": "Nope"})).status_code == 423

    # Revise Plan reopens it for the next cycle.
    assert (await client.post(f"/api/projects/{project_id}/revisions/reopen")).status_code == 204

    ok = await client.patch(base, json={"well_name": "Editable After Revise"})
    assert ok.status_code == 200
    assert ok.json()["well_name"] == "Editable After Revise"


@pytest.mark.asyncio
async def test_reopen_requires_an_approved_plan(client: AsyncClient) -> None:
    """Revise Plan is only valid when the plan is frozen by an APPROVED revision."""
    project_id, _ = await _project_with_activity(client)
    # Draft — nothing locked.
    assert (await client.post(f"/api/projects/{project_id}/revisions/reopen")).status_code == 409
    # Pending revision — resolve it through its own workflow, not reopen.
    await _create_revision(client, project_id)
    assert (await client.post(f"/api/projects/{project_id}/revisions/reopen")).status_code == 409


@pytest.mark.asyncio
async def test_reopen_denied_for_non_planner(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    """Reopen is a write — a designated approver who isn't a project member can't do it."""
    project_id, _ = await _project_with_activity(client)
    await client.post(
        f"/api/projects/{project_id}/approvers",
        json={"email": "other@company.com", "role_label": "Approver"},
    )
    revision_id = await _create_revision(client, project_id)
    await other_client.put(
        f"/api/projects/{project_id}/revisions/{revision_id}/sign",
        json={"role_label": "Manager"},
    )
    # other@ approved it but is not a member → cannot reopen the plan.
    assert (
        await other_client.post(f"/api/projects/{project_id}/revisions/reopen")
    ).status_code in (403, 404)


@pytest.mark.asyncio
async def test_project_lock_summary_tracks_lifecycle(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    """The project detail's `lock` summary drives the Revise Plan banner: draft →
    pending → approved (frozen) → draft."""
    project_id, _ = await _project_with_activity(client)
    await client.post(
        f"/api/projects/{project_id}/approvers",
        json={"email": "other@company.com", "role_label": "Approver"},
    )

    async def lock() -> dict:
        return (await client.get(f"/api/projects/{project_id}")).json()["lock"]

    assert (await lock())["locked"] is False

    revision_id = await _create_revision(client, project_id)
    pending = await lock()
    assert pending["locked"] and pending["reason"] == "pending"

    await other_client.put(
        f"/api/projects/{project_id}/revisions/{revision_id}/sign",
        json={"role_label": "Manager"},
    )
    approved = await lock()
    assert approved["locked"] and approved["reason"] == "approved"

    await client.post(f"/api/projects/{project_id}/revisions/reopen")
    assert (await lock())["locked"] is False
