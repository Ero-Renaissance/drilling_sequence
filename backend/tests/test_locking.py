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
async def test_edit_allowed_after_full_approval(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    """Directly answers 'is it editable once fully approved?': yes — approval
    unlocks the activities (immutable snapshot is retained on the revision)."""
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

    ok = await client.patch(base, json={"well_name": "Editable After Approval"})
    assert ok.status_code == 200
    assert ok.json()["well_name"] == "Editable After Approval"
