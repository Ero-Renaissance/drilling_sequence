import sys
import types

import pytest
from fastapi import HTTPException
from httpx import AsyncClient

from app.config import settings
from app.core.auth import _azure_scheme, _extract_claims, _resolve_admin


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


# ---------------------------------------------------------------------------
# Production auth path (Azure AD). The rest of the suite runs in dev mode and
# bypasses this; here we inject a fake bearer module (fastapi-azure-auth isn't
# installed in the test venv) and drive the helpers directly.
# ---------------------------------------------------------------------------

class _FakeClaims:
    def __init__(self, roles):
        self.oid = "oid-123"
        self.name = "Ada Approver"
        self.preferred_username = "ada@company.com"
        self.roles = roles


class _FakeBearer:
    """Stand-in for SingleTenantAzureAuthorizationCodeBearer."""

    instances = 0
    roles_to_return: list = ["Admin"]

    def __init__(self, app_client_id, tenant_id):
        type(self).instances += 1
        self.app_client_id = app_client_id
        self.tenant_id = tenant_id

    async def __call__(self, request):
        return _FakeClaims(self.roles_to_return)


class _Req:
    """Minimal stand-in for starlette Request (only .headers is read)."""

    def __init__(self, headers):
        self.headers = headers


def _install_fake_azure(monkeypatch, roles=("Admin",)):
    _FakeBearer.instances = 0
    _FakeBearer.roles_to_return = list(roles)
    module = types.ModuleType("fastapi_azure_auth")
    module.SingleTenantAzureAuthorizationCodeBearer = _FakeBearer
    monkeypatch.setitem(sys.modules, "fastapi_azure_auth", module)
    monkeypatch.setattr(settings, "dev_mode", False)
    monkeypatch.setattr(settings, "azure_client_id", "client-id")
    monkeypatch.setattr(settings, "azure_tenant_id", "tenant-id")
    _azure_scheme.cache_clear()


@pytest.fixture(autouse=True)
def _reset_scheme_cache():
    # The lru_cache is process-global; clear it around each test so a fake from
    # one test never leaks into another.
    _azure_scheme.cache_clear()
    yield
    _azure_scheme.cache_clear()


@pytest.mark.asyncio
async def test_extract_claims_maps_token_fields(monkeypatch) -> None:
    _install_fake_azure(monkeypatch, roles=["Admin", "Planner"])
    claims = await _extract_claims(_Req({"Authorization": "Bearer xyz"}))
    assert claims == {
        "oid": "oid-123",
        "name": "Ada Approver",
        "preferred_username": "ada@company.com",
        "roles": ["Admin", "Planner"],
    }


@pytest.mark.asyncio
async def test_extract_claims_rejects_missing_bearer(monkeypatch) -> None:
    monkeypatch.setattr(settings, "dev_mode", False)
    with pytest.raises(HTTPException) as exc:
        await _extract_claims(_Req({}))
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_extract_claims_dev_mode_short_circuits(monkeypatch) -> None:
    monkeypatch.setattr(settings, "dev_mode", True)
    claims = await _extract_claims(_Req({}))  # no token required in dev mode
    assert claims["preferred_username"] == "dev@company.com"


def test_azure_scheme_is_built_once(monkeypatch) -> None:
    _install_fake_azure(monkeypatch)
    first = _azure_scheme()
    second = _azure_scheme()
    assert first is second
    assert _FakeBearer.instances == 1  # constructed once, not per request


def test_resolve_admin_via_role_claim(monkeypatch) -> None:
    monkeypatch.setattr(settings, "dev_mode", False)
    monkeypatch.setattr(settings, "admin_role", "Admin")
    monkeypatch.setattr(settings, "admin_emails", "")
    assert _resolve_admin("user@company.com", {"roles": ["Admin"]}) is True
    assert _resolve_admin("user@company.com", {"roles": ["Viewer"]}) is False


def test_resolve_admin_via_allowlist_is_case_insensitive(monkeypatch) -> None:
    monkeypatch.setattr(settings, "dev_mode", False)
    monkeypatch.setattr(settings, "admin_role", "Admin")
    monkeypatch.setattr(settings, "admin_emails", "boss@company.com")
    assert _resolve_admin("BOSS@company.com", {}) is True
    assert _resolve_admin("intern@company.com", {"roles": []}) is False


def test_resolve_admin_denies_without_role_or_allowlist(monkeypatch) -> None:
    monkeypatch.setattr(settings, "dev_mode", False)
    monkeypatch.setattr(settings, "admin_role", "Admin")
    monkeypatch.setattr(settings, "admin_emails", "")
    assert _resolve_admin("nobody@company.com", {}) is False
