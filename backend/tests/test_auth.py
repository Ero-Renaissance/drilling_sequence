import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_get_me_returns_current_user(client: AsyncClient) -> None:
    response = await client.get("/api/auth/me")
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Test User"
    assert data["email"] == "test@company.com"
    assert "id" in data


@pytest.mark.asyncio
async def test_health_endpoint(client: AsyncClient) -> None:
    response = await client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
