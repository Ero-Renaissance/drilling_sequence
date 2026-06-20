import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import Project, ProjectMember, ProjectRole
from app.models.user import User

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _create_project(client: AsyncClient, name: str = "North Sea Campaign", **kwargs) -> dict:
    payload = {"name": name, **kwargs}
    response = await client.post("/api/projects", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


async def _materialize_other_user(other_client: AsyncClient, db: AsyncSession) -> User:
    """Force the second client's User row to be created, then return it so a test
    can set is_admin or attach a ProjectMember row directly."""
    await other_client.get("/api/projects")  # auth dependency upserts the user
    return (
        await db.execute(select(User).where(User.email == "other@company.com"))
    ).scalar_one()


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_create_project_minimal(client: AsyncClient) -> None:
    data = await _create_project(client, name="Alpha Campaign")
    assert data["name"] == "Alpha Campaign"
    assert data["status"] == "active"
    assert data["field"] is None
    assert data["region"] is None
    assert len(data["members"]) == 1
    assert data["members"][0]["role"] == "planner"


@pytest.mark.asyncio
async def test_create_project_with_metadata(client: AsyncClient) -> None:
    data = await _create_project(client, name="Beta Campaign", field="Bonga", region="Offshore")
    assert data["field"] == "Bonga"
    assert data["region"] == "Offshore"


@pytest.mark.asyncio
async def test_create_project_empty_name_rejected(client: AsyncClient) -> None:
    response = await client.post("/api/projects", json={"name": "  "})
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_create_project_defaults_review_policy_optional(client: AsyncClient) -> None:
    """New projects default to the 'optional' review policy (planner routes per revision)."""
    data = await _create_project(client, name="Policy Default")
    assert data["review_policy"] == "optional"


# ---------------------------------------------------------------------------
# List
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_list_projects_empty(client: AsyncClient) -> None:
    response = await client.get("/api/projects")
    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.asyncio
async def test_list_projects_shows_own_projects(client: AsyncClient) -> None:
    await _create_project(client, name="Project A")
    await _create_project(client, name="Project B")
    response = await client.get("/api/projects")
    assert response.status_code == 200
    names = {p["name"] for p in response.json()}
    assert names == {"Project A", "Project B"}


@pytest.mark.asyncio
async def test_list_projects_excludes_other_users(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    await _create_project(client, name="My Project")
    response = await other_client.get("/api/projects")
    assert response.json() == []


@pytest.mark.asyncio
async def test_list_projects_excludes_archived(client: AsyncClient) -> None:
    project = await _create_project(client, name="Old Project")
    await client.delete(f"/api/projects/{project['id']}")
    response = await client.get("/api/projects")
    assert response.json() == []


# ---------------------------------------------------------------------------
# Get
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_get_project(client: AsyncClient) -> None:
    project = await _create_project(client, name="Detailed Project", field="Agbami")
    response = await client.get(f"/api/projects/{project['id']}")
    assert response.status_code == 200
    assert response.json()["field"] == "Agbami"


@pytest.mark.asyncio
async def test_get_project_not_found(client: AsyncClient) -> None:
    response = await client.get("/api/projects/00000000-0000-0000-0000-000000000099")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_get_project_other_user_denied(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    project = await _create_project(client, name="Private Project")
    response = await other_client.get(f"/api/projects/{project['id']}")
    assert response.status_code == 403


# ---------------------------------------------------------------------------
# Update
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_update_project_name(client: AsyncClient) -> None:
    project = await _create_project(client, name="Old Name")
    response = await client.patch(f"/api/projects/{project['id']}", json={"name": "New Name"})
    assert response.status_code == 200
    assert response.json()["name"] == "New Name"


@pytest.mark.asyncio
async def test_update_project_partial(client: AsyncClient) -> None:
    project = await _create_project(client, name="Stable Name", field="Egina")
    response = await client.patch(
        f"/api/projects/{project['id']}", json={"region": "Deep Offshore"}
    )
    data = response.json()
    assert data["name"] == "Stable Name"
    assert data["field"] == "Egina"
    assert data["region"] == "Deep Offshore"


@pytest.mark.asyncio
async def test_update_project_other_user_denied(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    project = await _create_project(client, name="Owner Project")
    response = await other_client.patch(
        f"/api/projects/{project['id']}", json={"name": "Hijacked"}
    )
    assert response.status_code == 403


# ---------------------------------------------------------------------------
# Archive (soft delete)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_archive_project(client: AsyncClient) -> None:
    project = await _create_project(client, name="To Archive")
    response = await client.delete(f"/api/projects/{project['id']}")
    assert response.status_code == 204

    # Should no longer appear in list
    list_response = await client.get("/api/projects")
    assert not any(p["id"] == project["id"] for p in list_response.json())


@pytest.mark.asyncio
async def test_archive_project_other_user_denied(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    project = await _create_project(client, name="Protected Project")
    response = await other_client.delete(f"/api/projects/{project['id']}")
    assert response.status_code == 403


# ---------------------------------------------------------------------------
# RBAC: admin bypass + role gating (assert_member delegation)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_admin_can_access_non_member_project(
    client: AsyncClient, other_client: AsyncClient, db: AsyncSession
) -> None:
    """A global admin reaches a project they are not a member of (assert_member bypass)."""
    project = await _create_project(client, name="Admin Visible")
    other = await _materialize_other_user(other_client, db)
    other.is_admin = True
    await db.commit()

    # Read and write both succeed despite no membership row.
    assert (await other_client.get(f"/api/projects/{project['id']}")).status_code == 200
    patched = await other_client.patch(
        f"/api/projects/{project['id']}", json={"name": "Renamed by Admin"}
    )
    assert patched.status_code == 200
    assert patched.json()["name"] == "Renamed by Admin"


@pytest.mark.asyncio
async def test_viewer_member_cannot_update_project(
    client: AsyncClient, other_client: AsyncClient, db: AsyncSession
) -> None:
    """A viewer member can read but is blocked from the planner-only update path —
    exercising the allowed_roles branch distinctly from the non-member branch."""
    project = await _create_project(client, name="Role Gated")
    other = await _materialize_other_user(other_client, db)
    db.add(
        ProjectMember(
            project_id=uuid.UUID(project["id"]),
            user_id=other.id,
            role=ProjectRole.viewer,
        )
    )
    await db.commit()

    assert (await other_client.get(f"/api/projects/{project['id']}")).status_code == 200
    blocked = await other_client.patch(
        f"/api/projects/{project['id']}", json={"name": "Nope"}
    )
    assert blocked.status_code == 403


@pytest.mark.asyncio
async def test_clone_records_source_project(client: AsyncClient) -> None:
    source = await _create_project(client, name="North Sea Q1")
    assert source["cloned_from_project_id"] is None

    clone = (
        await client.post(f"/api/projects/{source['id']}/clone", json={"name": "North Sea Q2"})
    ).json()
    assert clone["cloned_from_project_id"] == source["id"]


@pytest.mark.asyncio
async def test_clone_inherits_review_policy(client: AsyncClient, db: AsyncSession) -> None:
    """A clone carries the source project's governance policy into the new quarter."""
    source = await _create_project(client, name="Governed Q1")
    row = (
        await db.execute(select(Project).where(Project.id == uuid.UUID(source["id"])))
    ).scalar_one()
    row.review_policy = "required"
    await db.commit()

    clone = (
        await client.post(f"/api/projects/{source['id']}/clone", json={"name": "Governed Q2"})
    ).json()
    assert clone["review_policy"] == "required"


@pytest.mark.asyncio
async def test_clone_copies_rig_contracts(client: AsyncClient) -> None:
    source = await _create_project(client, name="Q1")
    await client.put(
        f"/api/projects/{source['id']}/contracts/RigAlpha", json={"status": "In Progress"}
    )

    clone = (
        await client.post(f"/api/projects/{source['id']}/clone", json={"name": "Q2"})
    ).json()
    contracts = (await client.get(f"/api/projects/{clone['id']}/contracts")).json()
    assert any(
        c["rig_name"] == "RigAlpha" and c["status"] == "In Progress" for c in contracts
    )


@pytest.mark.asyncio
async def test_viewer_member_cannot_clone_project(
    client: AsyncClient, other_client: AsyncClient, db: AsyncSession
) -> None:
    """Cloning is a planner-only action — a viewer of the source cannot spin off a copy."""
    project = await _create_project(client, name="Source Campaign")
    other = await _materialize_other_user(other_client, db)
    db.add(
        ProjectMember(
            project_id=uuid.UUID(project["id"]),
            user_id=other.id,
            role=ProjectRole.viewer,
        )
    )
    await db.commit()

    blocked = await other_client.post(
        f"/api/projects/{project['id']}/clone", json={"name": "Q2 Copy"}
    )
    assert blocked.status_code == 403
