"""The global planner grant (users.can_plan).

Admins hand out the grant on the Admin page; only grant holders (and admins)
may create/clone campaigns or act as a campaign planner. Revoking the grant
strips planning rights everywhere immediately (checked at write time in
assert_member), and co-planners can only be added if they hold the grant.
"""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from tests.conftest import NOPLAN_USER_ID, OTHER_USER_ID, TEST_USER_ID


async def _create_project(client: AsyncClient, name: str = "Bonga Q3") -> dict:
    resp = await client.post("/api/projects", json={"name": name})
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _set_can_plan(db: AsyncSession, user_id: uuid.UUID, value: bool) -> None:
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one()
    user.can_plan = value
    await db.commit()


def _activity_payload(well: str) -> dict:
    return {
        "activity_type": "Oil Well Drilling",
        "start_date": "2026-01-01",
        "end_date": "2026-02-01",
        "well_name": well,
        "rig_name": "Rig Alpha",
        "location": "OFFSHORE",
        "plan_type": "Firm",
        "risk": "No Flood Risk",
    }


# ---------------------------------------------------------------------------
# Campaign creation gate
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_create_project_requires_planner_grant(noplan_client: AsyncClient) -> None:
    resp = await noplan_client.post("/api/projects", json={"name": "Rogue Campaign"})
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_create_project_allowed_with_grant(client: AsyncClient) -> None:
    project = await _create_project(client)
    roles = {m["user_email"]: m["role"] for m in project["members"]}
    assert roles["test@company.com"] == "planner"


@pytest.mark.asyncio
async def test_create_project_allowed_for_admin_without_grant(
    noplan_client: AsyncClient, db: AsyncSession
) -> None:
    # Ensure the user row exists before flagging admin (created on first request).
    resp = await noplan_client.get("/api/auth/me")
    assert resp.status_code == 200
    user = (await db.execute(select(User).where(User.id == NOPLAN_USER_ID))).scalar_one()
    user.is_admin = True
    await db.commit()

    resp = await noplan_client.post("/api/projects", json={"name": "Admin Campaign"})
    assert resp.status_code == 201


@pytest.mark.asyncio
async def test_clone_requires_planner_grant(
    client: AsyncClient, db: AsyncSession
) -> None:
    project = await _create_project(client)
    # Revoke the creator's grant, then try to clone their own campaign.
    await _set_can_plan(db, TEST_USER_ID, False)
    resp = await client.post(
        f"/api/projects/{project['id']}/clone", json={"name": "Bonga Q4"}
    )
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Write-time enforcement: revoking the grant kills planner powers everywhere
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_revoked_grant_blocks_plan_writes(
    client: AsyncClient, db: AsyncSession
) -> None:
    project = await _create_project(client)
    payload = _activity_payload("W-1")
    # With the grant: write succeeds.
    resp = await client.post(f"/api/projects/{project['id']}/activities", json=payload)
    assert resp.status_code == 201, resp.text

    # Grant revoked: the same planner-role member is refused.
    await _set_can_plan(db, TEST_USER_ID, False)
    resp = await client.post(f"/api/projects/{project['id']}/activities", json=payload)
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Co-planner management (strict rule: target must hold the grant)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_add_co_planner_happy_path(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    project = await _create_project(client)
    resp = await client.post(
        f"/api/projects/{project['id']}/planners", json={"email": "other@company.com"}
    )
    # Target must exist — trigger Other User's row creation first if needed.
    if resp.status_code == 404:
        assert (await other_client.get("/api/auth/me")).status_code == 200
        resp = await client.post(
            f"/api/projects/{project['id']}/planners", json={"email": "other@company.com"}
        )
    assert resp.status_code == 201, resp.text
    roles = {m["user_email"]: m["role"] for m in resp.json()["members"]}
    assert roles["other@company.com"] == "planner"

    # The co-planner can now edit the plan.
    resp = await other_client.post(
        f"/api/projects/{project['id']}/activities",
        json=_activity_payload("W-2"),
    )
    assert resp.status_code == 201, resp.text


@pytest.mark.asyncio
async def test_add_co_planner_rejected_without_target_grant(
    client: AsyncClient, noplan_client: AsyncClient
) -> None:
    project = await _create_project(client)
    assert (await noplan_client.get("/api/auth/me")).status_code == 200  # create row
    resp = await client.post(
        f"/api/projects/{project['id']}/planners", json={"email": "noplan@company.com"}
    )
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_add_co_planner_denied_to_non_planner(
    client: AsyncClient, noplan_client: AsyncClient
) -> None:
    project = await _create_project(client)
    resp = await noplan_client.post(
        f"/api/projects/{project['id']}/planners", json={"email": "other@company.com"}
    )
    assert resp.status_code == 403  # not a member/planner of this campaign


@pytest.mark.asyncio
async def test_add_co_planner_unknown_email_404(client: AsyncClient) -> None:
    project = await _create_project(client)
    resp = await client.post(
        f"/api/projects/{project['id']}/planners", json={"email": "ghost@company.com"}
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_remove_planner_and_last_planner_guard(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    project = await _create_project(client)
    assert (await other_client.get("/api/auth/me")).status_code == 200
    resp = await client.post(
        f"/api/projects/{project['id']}/planners", json={"email": "other@company.com"}
    )
    assert resp.status_code == 201

    # Remove the co-planner: fine.
    resp = await client.delete(f"/api/projects/{project['id']}/planners/{OTHER_USER_ID}")
    assert resp.status_code == 204

    # Removing the last planner is refused.
    resp = await client.delete(f"/api/projects/{project['id']}/planners/{TEST_USER_ID}")
    assert resp.status_code == 409


# ---------------------------------------------------------------------------
# Admin grant management
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_admin_can_toggle_planner_grant(
    client: AsyncClient, noplan_client: AsyncClient, db: AsyncSession
) -> None:
    # Materialise both user rows, then make Test User an admin.
    assert (await noplan_client.get("/api/auth/me")).status_code == 200
    assert (await client.get("/api/auth/me")).status_code == 200
    admin = (await db.execute(select(User).where(User.id == TEST_USER_ID))).scalar_one()
    admin.is_admin = True
    await db.commit()

    resp = await client.patch(
        f"/api/admin/users/{NOPLAN_USER_ID}", json={"can_plan": True}
    )
    assert resp.status_code == 200
    assert resp.json()["can_plan"] is True

    # The grant is effective immediately: the user can now create a campaign.
    resp = await noplan_client.post("/api/projects", json={"name": "Granted Campaign"})
    assert resp.status_code == 201


@pytest.mark.asyncio
async def test_admin_patch_requires_some_field(client: AsyncClient, db: AsyncSession) -> None:
    assert (await client.get("/api/auth/me")).status_code == 200  # materialise row
    admin = (await db.execute(select(User).where(User.id == TEST_USER_ID))).scalar_one()
    admin.is_admin = True
    await db.commit()
    resp = await client.patch(f"/api/admin/users/{TEST_USER_ID}", json={})
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_non_admin_cannot_toggle_grant(client: AsyncClient) -> None:
    resp = await client.patch(
        f"/api/admin/users/{NOPLAN_USER_ID}", json={"can_plan": True}
    )
    assert resp.status_code == 403
