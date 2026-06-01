"""Approver notifications: in-app pending-approvals feed + email no-op safety."""
import pytest
from httpx import AsyncClient

from app.services.email import send_email


async def _project_with_activity(client: AsyncClient, name: str = "Notify Project") -> str:
    r = await client.post("/api/projects", json={"name": name})
    assert r.status_code == 201, r.text
    project_id = r.json()["id"]
    await client.post(
        f"/api/projects/{project_id}/activities",
        json={"activity_type": "Drilling", "start_date": "2026-01-01", "end_date": "2026-03-31"},
    )
    return project_id


def test_send_email_noop_when_disabled() -> None:
    # Default config has no smtp_host → must return quietly, never raise.
    send_email(["someone@company.com"], "Subject", "Body")


@pytest.mark.asyncio
async def test_pending_approvals_lists_revisions_awaiting_my_signature(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    project_id = await _project_with_activity(client)
    # other@ is the designated approver; test@ is the planner/creator.
    await client.post(
        f"/api/projects/{project_id}/approvers",
        json={"email": "other@company.com", "role_label": "Approver"},
    )
    create_r = await client.post(f"/api/projects/{project_id}/revisions", json={})
    revision_id = create_r.json()["id"]

    r = await other_client.get("/api/me/pending-approvals")
    assert r.status_code == 200, r.text
    items = r.json()
    assert len(items) == 1
    assert items[0]["revision_id"] == revision_id
    assert items[0]["project_id"] == project_id
    assert items[0]["project_name"] == "Notify Project"


@pytest.mark.asyncio
async def test_pending_approvals_excludes_signed_revisions(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    project_id = await _project_with_activity(client)
    await client.post(
        f"/api/projects/{project_id}/approvers",
        json={"email": "other@company.com", "role_label": "Approver"},
    )
    create_r = await client.post(f"/api/projects/{project_id}/revisions", json={})
    revision_id = create_r.json()["id"]

    # Once other@ signs, it should drop off other@'s pending list.
    await other_client.put(
        f"/api/projects/{project_id}/revisions/{revision_id}/sign",
        json={"role_label": "Approver"},
    )

    r = await other_client.get("/api/me/pending-approvals")
    assert r.status_code == 200, r.text
    assert r.json() == []


@pytest.mark.asyncio
async def test_pending_approvals_excludes_own_submitted_revision(
    client: AsyncClient,
) -> None:
    """Separation of duties: a revision you submitted never appears on your own
    'awaiting my signature' list, even if you're also a designated approver."""
    project_id = await _project_with_activity(client)
    # test@ is both a designated approver AND the creator; other@ keeps submit valid.
    await client.post(
        f"/api/projects/{project_id}/approvers",
        json={"email": "test@company.com", "role_label": "Approver"},
    )
    await client.post(
        f"/api/projects/{project_id}/approvers",
        json={"email": "other@company.com", "role_label": "Approver"},
    )
    await client.post(f"/api/projects/{project_id}/revisions", json={})

    r = await client.get("/api/me/pending-approvals")
    assert r.status_code == 200, r.text
    assert r.json() == []


@pytest.mark.asyncio
async def test_pending_approvals_excludes_non_approver(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    project_id = await _project_with_activity(client)
    await client.post(
        f"/api/projects/{project_id}/approvers",
        json={"email": "test@company.com", "role_label": "Approver"},
    )
    await client.post(f"/api/projects/{project_id}/revisions", json={})

    # Other User is not a designated approver anywhere → empty feed.
    r = await other_client.get("/api/me/pending-approvals")
    assert r.status_code == 200, r.text
    assert r.json() == []


@pytest.mark.asyncio
async def test_reject_notifies_planner(
    client: AsyncClient, other_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    project_id = await _project_with_activity(client)
    # Other User is a designated approver so they can reject; Test User is the planner.
    await client.post(
        f"/api/projects/{project_id}/approvers",
        json={"email": "other@company.com", "role_label": "Approver"},
    )
    create_r = await client.post(f"/api/projects/{project_id}/revisions", json={"label": "Rev A"})
    revision_id = create_r.json()["id"]

    calls: list[dict] = []
    monkeypatch.setattr(
        "app.routers.revisions.notify_revision_decision",
        lambda **kwargs: calls.append(kwargs),
    )

    r = await other_client.post(
        f"/api/projects/{project_id}/revisions/{revision_id}/reject",
        json={"reason": "Dates clash with rig availability"},
    )
    assert r.status_code == 200, r.text

    assert len(calls) == 1
    assert calls[0]["recipient"] == "test@company.com"  # the planner/creator
    assert calls[0]["outcome"] == "rejected"
    assert calls[0]["reason"] == "Dates clash with rig availability"
    assert calls[0]["decided_by"] == "Other User"


@pytest.mark.asyncio
async def test_creator_cannot_decide_own_revision(client: AsyncClient) -> None:
    """Separation of duties: the submitter can't reject / request-changes their
    own revision (they discard it instead). Even being a designated approver
    doesn't let them — a second approver keeps submit valid."""
    project_id = await _project_with_activity(client)
    await client.post(
        f"/api/projects/{project_id}/approvers",
        json={"email": "test@company.com", "role_label": "Approver"},
    )
    await client.post(
        f"/api/projects/{project_id}/approvers",
        json={"email": "other@company.com", "role_label": "Approver"},
    )
    create_r = await client.post(f"/api/projects/{project_id}/revisions", json={})
    revision_id = create_r.json()["id"]

    r = await client.post(
        f"/api/projects/{project_id}/revisions/{revision_id}/request-changes",
        json={"reason": "changed my mind"},
    )
    assert r.status_code == 403
