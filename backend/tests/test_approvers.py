"""Tests for configurable approvers and approver-aware sign flow."""
import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from tests.conftest import OTHER_USER_ID, THIRD_USER_ID


async def _setup(client: AsyncClient) -> tuple[str, str]:
    """Return (project_id, revision_id) with 2 configured approvers and a pending
    revision. The creator (test@company.com) is deliberately NOT an approver —
    they can't sign their own plan — so the two approvers are other@ and third@.
    """
    # project
    r = await client.post("/api/projects", json={"name": "Approver Test Project"})
    assert r.status_code == 201
    project_id = r.json()["id"]

    # activity so we can create a revision
    await client.post(
        f"/api/projects/{project_id}/activities",
        json={"activity_type": "Drilling", "start_date": "2026-01-01", "end_date": "2026-03-31"},
    )

    # Configure required approvers (both distinct from the creator)
    await client.post(
        f"/api/projects/{project_id}/approvers",
        json={"email": "other@company.com", "name": "Other User", "role_label": "Project Manager"},
    )
    await client.post(
        f"/api/projects/{project_id}/approvers",
        json={"email": "third@company.com", "name": "Third User", "role_label": "HSE Manager"},
    )

    # revision
    r = await client.post(f"/api/projects/{project_id}/revisions", json={})
    assert r.status_code == 201
    revision_id = r.json()["id"]

    return project_id, revision_id


# ── Approver CRUD ─────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_add_approver(client: AsyncClient) -> None:
    r = await client.post("/api/projects", json={"name": "P"})
    project_id = r.json()["id"]

    r = await client.post(
        f"/api/projects/{project_id}/approvers",
        json={"email": "alice@company.com", "name": "Alice", "role_label": "Manager"},
    )
    assert r.status_code == 201
    data = r.json()
    assert data["email"] == "alice@company.com"
    assert data["role_label"] == "Manager"


@pytest.mark.asyncio
async def test_email_is_lowercased(client: AsyncClient) -> None:
    r = await client.post("/api/projects", json={"name": "P"})
    project_id = r.json()["id"]

    r = await client.post(
        f"/api/projects/{project_id}/approvers",
        json={"email": "Alice@Company.COM"},
    )
    assert r.status_code == 201
    assert r.json()["email"] == "alice@company.com"


@pytest.mark.asyncio
async def test_duplicate_email_returns_409(client: AsyncClient) -> None:
    r = await client.post("/api/projects", json={"name": "P"})
    project_id = r.json()["id"]

    await client.post(
        f"/api/projects/{project_id}/approvers", json={"email": "dup@company.com"}
    )
    r = await client.post(
        f"/api/projects/{project_id}/approvers", json={"email": "dup@company.com"}
    )
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_list_approvers(client: AsyncClient) -> None:
    r = await client.post("/api/projects", json={"name": "P"})
    project_id = r.json()["id"]

    await client.post(f"/api/projects/{project_id}/approvers", json={"email": "a@x.com"})
    await client.post(f"/api/projects/{project_id}/approvers", json={"email": "b@x.com"})

    r = await client.get(f"/api/projects/{project_id}/approvers")
    assert r.status_code == 200
    assert len(r.json()) == 2


@pytest.mark.asyncio
async def test_remove_approver(client: AsyncClient) -> None:
    r = await client.post("/api/projects", json={"name": "P"})
    project_id = r.json()["id"]

    r = await client.post(f"/api/projects/{project_id}/approvers", json={"email": "x@x.com"})
    approver_id = r.json()["id"]

    r = await client.delete(f"/api/projects/{project_id}/approvers/{approver_id}")
    assert r.status_code == 204

    r = await client.get(f"/api/projects/{project_id}/approvers")
    assert r.json() == []


@pytest.mark.asyncio
async def test_non_member_cannot_access_approvers(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    """Approver list/add/remove are gated by project membership."""
    r = await client.post("/api/projects", json={"name": "P"})
    project_id = r.json()["id"]
    r = await client.post(
        f"/api/projects/{project_id}/approvers", json={"email": "x@x.com"}
    )
    approver_id = r.json()["id"]

    # Other User has no membership → every approver endpoint is forbidden
    assert (await other_client.get(f"/api/projects/{project_id}/approvers")).status_code == 403
    assert (
        await other_client.post(
            f"/api/projects/{project_id}/approvers", json={"email": "y@y.com"}
        )
    ).status_code == 403
    assert (
        await other_client.delete(
            f"/api/projects/{project_id}/approvers/{approver_id}"
        )
    ).status_code == 403


# ── Approval flow with configured approvers ───────────────────────────────────


@pytest.mark.asyncio
async def test_approver_status_shows_unsigned(client: AsyncClient) -> None:
    project_id, revision_id = await _setup(client)

    r = await client.get(f"/api/projects/{project_id}/revisions")
    data = r.json()[0]
    assert data["status"] == "pending_approval"
    statuses = data["approver_status"]
    assert len(statuses) == 2
    assert all(s["signed"] is False for s in statuses)


@pytest.mark.asyncio
async def test_partial_sign_does_not_approve(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    project_id, revision_id = await _setup(client)

    # other@company.com signs — but third@company.com hasn't yet
    r = await other_client.put(
        f"/api/projects/{project_id}/revisions/{revision_id}/sign",
        json={"role_label": "Project Manager"},
    )
    assert r.status_code == 200
    data = r.json()
    # Still pending because third@company.com hasn't signed
    assert data["status"] == "pending_approval"
    # Approver status updated
    statuses = {s["email"]: s for s in data["approver_status"]}
    assert statuses["other@company.com"]["signed"] is True
    assert statuses["third@company.com"]["signed"] is False


@pytest.mark.asyncio
async def test_all_approvers_signed_triggers_approval(
    client: AsyncClient, other_client: AsyncClient, third_client: AsyncClient
) -> None:
    project_id, revision_id = await _setup(client)

    # First approver (other@company.com) signs
    await other_client.put(
        f"/api/projects/{project_id}/revisions/{revision_id}/sign",
        json={"role_label": "Project Manager"},
    )

    # Second approver (third@company.com) signs
    r = await third_client.put(
        f"/api/projects/{project_id}/revisions/{revision_id}/sign",
        json={"role_label": "HSE Manager"},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "approved"
    assert len(data["signatures"]) == 2
    assert all(s["signed"] for s in data["approver_status"])

    # Activities should now be unlocked
    acts = (await client.get(f"/api/projects/{project_id}/activities")).json()
    assert all(a["locked_by_revision_id"] is None for a in acts)


@pytest.mark.asyncio
async def test_no_approvers_configured_cannot_approve(
    client: AsyncClient, other_client: AsyncClient, db: AsyncSession
) -> None:
    """With no approvers configured, only an admin can even sign — and the
    signature is recorded but the revision still can't auto-approve."""
    r = await client.post("/api/projects", json={"name": "No-approver project"})
    project_id = r.json()["id"]
    await client.post(
        f"/api/projects/{project_id}/activities",
        json={"activity_type": "X", "start_date": "2026-01-01", "end_date": "2026-01-31"},
    )
    r = await client.post(f"/api/projects/{project_id}/revisions", json={})
    revision_id = r.json()["id"]

    # Promote other@ to global admin so they're permitted to sign at all.
    await other_client.get("/api/projects")  # materialize the user row
    other = (
        await db.execute(select(User).where(User.id == OTHER_USER_ID))
    ).scalar_one()
    other.is_admin = True
    await db.commit()

    r = await other_client.put(
        f"/api/projects/{project_id}/revisions/{revision_id}/sign",
        json={"role_label": "Manager"},
    )
    assert r.status_code == 200
    assert r.json()["status"] == "pending_approval"
    assert len(r.json()["signatures"]) == 1


@pytest.mark.asyncio
async def test_admin_signature_does_not_trigger_approval(
    client: AsyncClient,
    other_client: AsyncClient,
    third_client: AsyncClient,
    db: AsyncSession,
) -> None:
    """An admin may sign even when not a required approver, but it doesn't count
    toward auto-approval — only the designated approver's signature does."""
    r = await client.post("/api/projects", json={"name": "P"})
    project_id = r.json()["id"]
    await client.post(
        f"/api/projects/{project_id}/activities",
        json={"activity_type": "X", "start_date": "2026-01-01", "end_date": "2026-01-31"},
    )
    # other@company.com is the sole required approver.
    await client.post(
        f"/api/projects/{project_id}/approvers",
        json={"email": "other@company.com", "role_label": "PM"},
    )
    r = await client.post(f"/api/projects/{project_id}/revisions", json={})
    revision_id = r.json()["id"]

    # third@ is a global admin (permitted to sign) but not a required approver.
    await third_client.get("/api/projects")  # ensure the user row exists
    third = (
        await db.execute(select(User).where(User.id == THIRD_USER_ID))
    ).scalar_one()
    third.is_admin = True
    await db.commit()

    r = await third_client.put(
        f"/api/projects/{project_id}/revisions/{revision_id}/sign",
        json={"role_label": "Observer"},
    )
    assert r.status_code == 200
    # Not approved yet — required other@company.com hasn't signed
    assert r.json()["status"] == "pending_approval"

    # Now the required approver signs → approved
    r = await other_client.put(
        f"/api/projects/{project_id}/revisions/{revision_id}/sign",
        json={"role_label": "PM"},
    )
    assert r.status_code == 200
    assert r.json()["status"] == "approved"


@pytest.mark.asyncio
async def test_outsider_cannot_sign(client: AsyncClient, other_client: AsyncClient) -> None:
    """A user who is neither an admin nor a designated approver is denied."""
    r = await client.post("/api/projects", json={"name": "P"})
    project_id = r.json()["id"]
    await client.post(
        f"/api/projects/{project_id}/activities",
        json={"activity_type": "X", "start_date": "2026-01-01", "end_date": "2026-01-31"},
    )
    r = await client.post(f"/api/projects/{project_id}/revisions", json={})
    revision_id = r.json()["id"]

    # Other User has no relationship to the project → forbidden
    r = await other_client.put(
        f"/api/projects/{project_id}/revisions/{revision_id}/sign",
        json={"role_label": "Observer"},
    )
    assert r.status_code == 403
