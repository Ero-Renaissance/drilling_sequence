import pytest
from httpx import AsyncClient


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _create_project(client: AsyncClient, name: str = "North Sea Campaign", **kwargs) -> dict:
    payload = {"name": name, **kwargs}
    response = await client.post("/api/projects", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


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
