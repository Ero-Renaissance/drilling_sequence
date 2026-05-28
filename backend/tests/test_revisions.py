"""Tests for Phase 6: revision snapshots and signatures."""
import json

import pytest
from httpx import AsyncClient


async def _create_project(client: AsyncClient, name: str = "Rev Test Project") -> str:
    r = await client.post(
        "/api/projects",
        json={"name": name, "field": "North Sea", "region": "Offshore"},
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _create_activity(client: AsyncClient, project_id: str, seq: int = 1) -> str:
    r = await client.post(
        f"/api/projects/{project_id}/activities",
        json={
            "activity_type": f"Activity {seq}",
            "start_date": f"2026-0{seq}-01",
            "end_date": f"2026-0{seq}-28",
        },
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _create_project_with_activities(client: AsyncClient) -> tuple[str, list[str]]:
    project_id = await _create_project(client)
    ids = [await _create_activity(client, project_id, i + 1) for i in range(2)]
    return project_id, ids


async def _add_self_approver(client: AsyncClient, project_id: str) -> None:
    """Configure the test user (test@company.com) as a required approver so that
    a single signature is enough to auto-approve the revision."""
    r = await client.post(
        f"/api/projects/{project_id}/approvers",
        json={"email": "test@company.com", "role_label": "Approver"},
    )
    assert r.status_code == 201, r.text


@pytest.mark.asyncio
async def test_create_revision(client: AsyncClient) -> None:
    project_id, _ = await _create_project_with_activities(client)

    r = await client.post(
        f"/api/projects/{project_id}/revisions",
        json={"label": "Initial plan"},
    )
    assert r.status_code == 201, r.text
    data = r.json()
    assert data["rev_number"] == 1
    assert data["label"] == "Initial plan"
    assert data["status"] == "pending_approval"
    assert data["signatures"] == []


@pytest.mark.asyncio
async def test_create_revision_auto_label(client: AsyncClient) -> None:
    project_id, _ = await _create_project_with_activities(client)

    r = await client.post(f"/api/projects/{project_id}/revisions", json={})
    assert r.status_code == 201, r.text
    assert r.json()["label"] == "Rev. 01"


@pytest.mark.asyncio
async def test_create_revision_no_activities_fails(client: AsyncClient) -> None:
    project_id = await _create_project(client, "Empty Project")
    r = await client.post(f"/api/projects/{project_id}/revisions", json={})
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_create_revision_locks_activities(client: AsyncClient) -> None:
    project_id, _ = await _create_project_with_activities(client)

    r = await client.post(f"/api/projects/{project_id}/revisions", json={})
    revision_id = r.json()["id"]

    activities = (await client.get(f"/api/projects/{project_id}/activities")).json()
    assert all(a["locked_by_revision_id"] == revision_id for a in activities)


@pytest.mark.asyncio
async def test_cannot_create_second_pending_revision(client: AsyncClient) -> None:
    project_id, _ = await _create_project_with_activities(client)
    await client.post(f"/api/projects/{project_id}/revisions", json={})

    r = await client.post(f"/api/projects/{project_id}/revisions", json={})
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_list_revisions(client: AsyncClient) -> None:
    project_id, _ = await _create_project_with_activities(client)
    await client.post(f"/api/projects/{project_id}/revisions", json={"label": "Rev A"})

    r = await client.get(f"/api/projects/{project_id}/revisions")
    assert r.status_code == 200, r.text
    revisions = r.json()
    assert len(revisions) == 1
    assert revisions[0]["label"] == "Rev A"


@pytest.mark.asyncio
async def test_get_revision_detail_has_snapshot(client: AsyncClient) -> None:
    project_id, _ = await _create_project_with_activities(client)
    create_r = await client.post(f"/api/projects/{project_id}/revisions", json={})
    revision_id = create_r.json()["id"]

    r = await client.get(f"/api/projects/{project_id}/revisions/{revision_id}")
    assert r.status_code == 200, r.text
    data = r.json()
    assert "snapshot_json" in data
    snapshot = json.loads(data["snapshot_json"])
    assert len(snapshot) == 2
    assert snapshot[0]["activity_type"] == "Activity 1"


@pytest.mark.asyncio
async def test_sign_revision_approves_and_unlocks(client: AsyncClient) -> None:
    project_id, _ = await _create_project_with_activities(client)
    await _add_self_approver(client, project_id)
    create_r = await client.post(f"/api/projects/{project_id}/revisions", json={})
    revision_id = create_r.json()["id"]

    r = await client.put(
        f"/api/projects/{project_id}/revisions/{revision_id}/sign",
        json={"role_label": "Project Manager"},
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["status"] == "approved"
    assert len(data["signatures"]) == 1
    assert data["signatures"][0]["role_label"] == "Project Manager"
    assert data["signatures"][0]["user_name"] == "Test User"

    # Activities unlocked
    activities = (await client.get(f"/api/projects/{project_id}/activities")).json()
    assert all(a["locked_by_revision_id"] is None for a in activities)


@pytest.mark.asyncio
async def test_sign_revision_twice_returns_409(client: AsyncClient) -> None:
    project_id, _ = await _create_project_with_activities(client)
    create_r = await client.post(f"/api/projects/{project_id}/revisions", json={})
    revision_id = create_r.json()["id"]

    await client.put(
        f"/api/projects/{project_id}/revisions/{revision_id}/sign",
        json={"role_label": "Manager"},
    )
    r = await client.put(
        f"/api/projects/{project_id}/revisions/{revision_id}/sign",
        json={"role_label": "Manager"},
    )
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_discard_revision_unlocks_activities(client: AsyncClient) -> None:
    project_id, _ = await _create_project_with_activities(client)
    create_r = await client.post(f"/api/projects/{project_id}/revisions", json={})
    revision_id = create_r.json()["id"]

    r = await client.delete(f"/api/projects/{project_id}/revisions/{revision_id}")
    assert r.status_code == 204

    activities = (await client.get(f"/api/projects/{project_id}/activities")).json()
    assert all(a["locked_by_revision_id"] is None for a in activities)


@pytest.mark.asyncio
async def test_discard_approved_revision_fails(client: AsyncClient) -> None:
    project_id, _ = await _create_project_with_activities(client)
    await _add_self_approver(client, project_id)
    create_r = await client.post(f"/api/projects/{project_id}/revisions", json={})
    revision_id = create_r.json()["id"]

    await client.put(
        f"/api/projects/{project_id}/revisions/{revision_id}/sign",
        json={"role_label": "Manager"},
    )
    r = await client.delete(f"/api/projects/{project_id}/revisions/{revision_id}")
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_rev_number_increments(client: AsyncClient) -> None:
    project_id, _ = await _create_project_with_activities(client)
    await _add_self_approver(client, project_id)

    r1 = await client.post(f"/api/projects/{project_id}/revisions", json={})
    rev1_id = r1.json()["id"]
    await client.put(
        f"/api/projects/{project_id}/revisions/{rev1_id}/sign",
        json={"role_label": "Manager"},
    )

    r2 = await client.post(f"/api/projects/{project_id}/revisions", json={})
    assert r2.status_code == 201, r2.text
    assert r2.json()["rev_number"] == 2
    assert r2.json()["label"] == "Rev. 02"


# ── RBAC: non-members are denied ────────────────────────────────────────────


@pytest.mark.asyncio
async def test_non_member_cannot_access_revisions(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    project_id, _ = await _create_project_with_activities(client)
    create_r = await client.post(f"/api/projects/{project_id}/revisions", json={})
    revision_id = create_r.json()["id"]

    # Other User is not a member of this project → every endpoint is forbidden
    assert (await other_client.get(f"/api/projects/{project_id}/revisions")).status_code == 403
    assert (
        await other_client.get(f"/api/projects/{project_id}/revisions/{revision_id}")
    ).status_code == 403
    assert (
        await other_client.post(f"/api/projects/{project_id}/revisions", json={})
    ).status_code == 403
    assert (
        await other_client.delete(f"/api/projects/{project_id}/revisions/{revision_id}")
    ).status_code == 403
    assert (
        await other_client.post(
            f"/api/projects/{project_id}/revisions/{revision_id}/reject",
            json={"reason": "no"},
        )
    ).status_code == 403
    assert (
        await other_client.post(
            f"/api/projects/{project_id}/revisions/{revision_id}/request-changes",
            json={"reason": "no"},
        )
    ).status_code == 403


# ── Reject / request-changes workflow ───────────────────────────────────────


@pytest.mark.asyncio
async def test_reject_revision_unlocks_and_records_reason(client: AsyncClient) -> None:
    project_id, _ = await _create_project_with_activities(client)
    create_r = await client.post(f"/api/projects/{project_id}/revisions", json={})
    revision_id = create_r.json()["id"]

    r = await client.post(
        f"/api/projects/{project_id}/revisions/{revision_id}/reject",
        json={"reason": "Dates conflict with rig availability"},
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["status"] == "rejected"
    assert data["decision_reason"] == "Dates conflict with rig availability"
    assert data["decision_by_name"] == "Test User"
    assert data["decision_at"] is not None

    # Activities unlocked
    activities = (await client.get(f"/api/projects/{project_id}/activities")).json()
    assert all(a["locked_by_revision_id"] is None for a in activities)


@pytest.mark.asyncio
async def test_request_changes_reopens_for_new_revision(client: AsyncClient) -> None:
    project_id, _ = await _create_project_with_activities(client)
    create_r = await client.post(f"/api/projects/{project_id}/revisions", json={})
    revision_id = create_r.json()["id"]

    r = await client.post(
        f"/api/projects/{project_id}/revisions/{revision_id}/request-changes",
        json={"reason": "Please add the casing run activity"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "changes_requested"
    assert r.json()["decision_reason"] == "Please add the casing run activity"

    # No longer pending → planner can create a fresh revision
    r2 = await client.post(f"/api/projects/{project_id}/revisions", json={})
    assert r2.status_code == 201
    assert r2.json()["rev_number"] == 2


@pytest.mark.asyncio
async def test_reject_requires_reason(client: AsyncClient) -> None:
    project_id, _ = await _create_project_with_activities(client)
    create_r = await client.post(f"/api/projects/{project_id}/revisions", json={})
    revision_id = create_r.json()["id"]

    r = await client.post(
        f"/api/projects/{project_id}/revisions/{revision_id}/reject",
        json={"reason": ""},
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_cannot_reject_already_decided_revision(client: AsyncClient) -> None:
    project_id, _ = await _create_project_with_activities(client)
    create_r = await client.post(f"/api/projects/{project_id}/revisions", json={})
    revision_id = create_r.json()["id"]

    await client.post(
        f"/api/projects/{project_id}/revisions/{revision_id}/reject",
        json={"reason": "first"},
    )
    r = await client.post(
        f"/api/projects/{project_id}/revisions/{revision_id}/reject",
        json={"reason": "again"},
    )
    assert r.status_code == 400
