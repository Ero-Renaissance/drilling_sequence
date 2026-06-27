"""Tests for governance events recorded in the project audit feed."""
import pytest
from httpx import AsyncClient


async def _project_with_activity(client: AsyncClient, name: str = "Audit Project") -> str:
    r = await client.post("/api/projects", json={"name": name})
    assert r.status_code == 201, r.text
    project_id = r.json()["id"]
    await client.post(
        f"/api/projects/{project_id}/activities",
        json={
            "activity_type": "Drilling",
            "start_date": "2026-01-01",
            "end_date": "2026-03-31",
            "well_name": "Well-1",
            "location": "OFFSHORE",
            "plan_type": "Firm",
            "risk": "No Flood Risk",
        },
    )
    return project_id


async def _audit(client: AsyncClient, project_id: str) -> list[dict]:
    r = await client.get(f"/api/projects/{project_id}/audit")
    assert r.status_code == 200, r.text
    return r.json()


def _find(entries: list[dict], entity_type: str, action: str) -> dict | None:
    return next(
        (e for e in entries if e["entity_type"] == entity_type and e["field"] == action),
        None,
    )


@pytest.mark.asyncio
async def test_project_create_is_audited(client: AsyncClient) -> None:
    r = await client.post("/api/projects", json={"name": "Brand New"})
    project_id = r.json()["id"]

    entry = _find(await _audit(client, project_id), "project", "created")
    assert entry is not None
    assert entry["entity_id"] == project_id
    assert "Brand New" in entry["new_value"]
    assert entry["user_name"] == "Test User"


@pytest.mark.asyncio
async def test_project_clone_is_audited(client: AsyncClient) -> None:
    source_id = await _project_with_activity(client, "Quarter 1")

    r = await client.post(f"/api/projects/{source_id}/clone", json={"name": "Quarter 2"})
    assert r.status_code == 201, r.text
    clone_id = r.json()["id"]

    entry = _find(await _audit(client, clone_id), "project", "cloned")
    assert entry is not None
    assert entry["old_value"] == source_id  # source project id
    assert "Quarter 1" in entry["new_value"]


@pytest.mark.asyncio
async def test_approver_add_and_remove_are_audited(client: AsyncClient) -> None:
    project_id = await _project_with_activity(client)

    r = await client.post(
        f"/api/projects/{project_id}/approvers",
        json={"email": "Alice@Company.com", "name": "Alice", "role_label": "HSE"},
    )
    approver_id = r.json()["id"]

    added = _find(await _audit(client, project_id), "approver", "added")
    assert added is not None
    assert added["entity_id"] == approver_id
    assert "alice@company.com" in added["new_value"]

    assert (
        await client.delete(f"/api/projects/{project_id}/approvers/{approver_id}")
    ).status_code == 204

    removed = _find(await _audit(client, project_id), "approver", "removed")
    assert removed is not None
    assert "alice@company.com" in removed["new_value"]


@pytest.mark.asyncio
async def test_sign_and_approve_are_audited(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    project_id = await _project_with_activity(client)
    # other@ is the required approver (the creator can't sign their own plan).
    await client.post(
        f"/api/projects/{project_id}/approvers",
        json={"email": "other@company.com", "role_label": "Approver"},
    )
    r = await client.post(f"/api/projects/{project_id}/revisions", json={})
    revision_id = r.json()["id"]

    # Sole required approver signs → revision both signs and approves
    await other_client.put(
        f"/api/projects/{project_id}/revisions/{revision_id}/sign",
        json={"role_label": "Project Manager"},
    )

    entries = await _audit(client, project_id)
    signed = _find(entries, "revision", "signed")
    approved = _find(entries, "revision", "approved")
    assert signed is not None and signed["entity_id"] == revision_id
    assert "Project Manager" in signed["new_value"]
    assert approved is not None and approved["entity_id"] == revision_id


@pytest.mark.asyncio
async def test_discard_is_audited(client: AsyncClient) -> None:
    project_id = await _project_with_activity(client)
    r = await client.post(f"/api/projects/{project_id}/revisions", json={})
    revision_id = r.json()["id"]

    assert (
        await client.delete(f"/api/projects/{project_id}/revisions/{revision_id}")
    ).status_code == 204

    entry = _find(await _audit(client, project_id), "revision", "discarded")
    assert entry is not None
    assert entry["entity_id"] == revision_id


@pytest.mark.asyncio
async def test_rig_contract_changes_are_audited(client: AsyncClient) -> None:
    project_id = await _project_with_activity(client)

    # Create
    r = await client.put(
        f"/api/projects/{project_id}/contracts/Rig-3",
        json={"status": "Completed", "contract_end": "2026-12-01"},
    )
    assert r.status_code == 200, r.text
    created = _find(await _audit(client, project_id), "contract", "contract_created")
    assert created is not None
    assert created["entity_id"] == r.json()["id"]
    assert "Rig-3" in created["new_value"] and "Completed" in created["new_value"]

    # Update — the prior state is captured in old_value
    r2 = await client.put(
        f"/api/projects/{project_id}/contracts/Rig-3",
        json={"status": "Completed", "contract_end": "2027-03-01"},
    )
    assert r2.status_code == 200, r2.text
    updated = _find(await _audit(client, project_id), "contract", "contract_updated")
    assert updated is not None
    assert "2027-03-01" in updated["new_value"]
    assert updated["old_value"] is not None

    # Delete
    assert (
        await client.delete(f"/api/projects/{project_id}/contracts/Rig-3")
    ).status_code == 204
    deleted = _find(await _audit(client, project_id), "contract", "contract_deleted")
    assert deleted is not None
    assert "Rig-3" in deleted["new_value"]


@pytest.mark.asyncio
async def test_hwu_contract_change_is_audited(client: AsyncClient) -> None:
    project_id = await _project_with_activity(client)
    r = await client.put(
        f"/api/projects/{project_id}/hwu-contracts/Unit-9",
        json={"status": "Completed", "contract_end": "2026-12-01"},
    )
    assert r.status_code == 200, r.text
    created = _find(await _audit(client, project_id), "contract", "contract_created")
    assert created is not None
    assert "HWU Unit-9" in created["new_value"]


@pytest.mark.asyncio
async def test_audit_feed_denied_to_non_member(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    project_id = await _project_with_activity(client)
    r = await other_client.get(f"/api/projects/{project_id}/audit")
    assert r.status_code in (403, 404)
