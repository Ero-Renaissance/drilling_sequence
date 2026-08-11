import logging
import types

import pytest
from fastapi import HTTPException
from httpx import AsyncClient

from app.config import settings
from app.core.auth import _extract_claims, _identity_from_header, _resolve_admin


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
# Production auth path: identity comes from a trusted reverse-proxy header
# (IIS/ARR doing Windows Integrated Auth). The rest of the suite runs in dev
# mode and bypasses this; here we drive the helpers directly.
# ---------------------------------------------------------------------------

class _Req:
    """Minimal stand-in for starlette Request (.headers/.method/.url are read)."""

    def __init__(self, headers):
        self.headers = headers
        self.method = "GET"
        self.url = types.SimpleNamespace(path="/api/test")


def _prod(monkeypatch, *, header="X-Remote-User", secret="", domain=""):
    """Put the app in production-style header-auth mode for a test."""
    monkeypatch.setattr(settings, "dev_mode", False)
    monkeypatch.setattr(settings, "proxy_user_header", header)
    monkeypatch.setattr(settings, "proxy_shared_secret", secret)
    monkeypatch.setattr(settings, "user_email_domain", domain)


@pytest.mark.asyncio
async def test_extract_claims_dev_mode_short_circuits(monkeypatch) -> None:
    monkeypatch.setattr(settings, "dev_mode", True)
    claims = await _extract_claims(_Req({}))  # no header required in dev mode
    assert claims["preferred_username"] == "dev@company.com"


@pytest.mark.asyncio
async def test_extract_claims_maps_domain_qualified_user(monkeypatch) -> None:
    _prod(monkeypatch, domain="renaissanceafrica.com")
    claims = await _extract_claims(_Req({"X-Remote-User": "SPINNG\\Osahon.Ero"}))
    assert claims == {
        "oid": "osahon.ero",
        "name": "Osahon.Ero",
        "preferred_username": "osahon.ero@renaissanceafrica.com",
        "username": "osahon.ero",
    }


@pytest.mark.asyncio
async def test_extract_claims_accepts_upn_and_keeps_email(monkeypatch) -> None:
    # A UPN header keeps its own email even when user_email_domain differs.
    _prod(monkeypatch, domain="ignored.example")
    claims = await _extract_claims(_Req({"X-Remote-User": "Jane.Doe@corp.example"}))
    assert claims["oid"] == "jane.doe"
    assert claims["preferred_username"] == "jane.doe@corp.example"


@pytest.mark.asyncio
async def test_extract_claims_rejects_missing_header(monkeypatch) -> None:
    _prod(monkeypatch)
    with pytest.raises(HTTPException) as exc:
        await _extract_claims(_Req({}))
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_extract_claims_rejects_malformed_header(monkeypatch) -> None:
    _prod(monkeypatch)
    with pytest.raises(HTTPException) as exc:
        await _extract_claims(_Req({"X-Remote-User": "not a valid name!"}))
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_extract_claims_does_not_log_the_rejected_value(monkeypatch, caplog) -> None:
    """A rejected header still 401s the client; the account value must never be
    written to the log (no PII/identifiers on the failure path)."""
    _prod(monkeypatch)
    with caplog.at_level(logging.WARNING, logger="app.core.auth"):
        with pytest.raises(HTTPException):
            await _extract_claims(_Req({"X-Remote-User": "zzsecretzz!"}))
    assert "zzsecretzz" not in caplog.text


@pytest.mark.asyncio
async def test_shared_secret_required_when_configured(monkeypatch) -> None:
    _prod(monkeypatch, secret="s3cr3t")
    # Valid user header but no secret → rejected.
    with pytest.raises(HTTPException) as exc:
        await _extract_claims(_Req({"X-Remote-User": "SPINNG\\jane.doe"}))
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_shared_secret_rejects_wrong_value(monkeypatch) -> None:
    _prod(monkeypatch, secret="s3cr3t")
    with pytest.raises(HTTPException) as exc:
        await _extract_claims(
            _Req({"X-Remote-User": "SPINNG\\jane.doe", "X-Proxy-Auth": "wrong"})
        )
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_shared_secret_accepts_matching_value(monkeypatch) -> None:
    _prod(monkeypatch, secret="s3cr3t", domain="corp.example")
    claims = await _extract_claims(
        _Req({"X-Remote-User": "SPINNG\\jane.doe", "X-Proxy-Auth": "s3cr3t"})
    )
    assert claims["oid"] == "jane.doe"


def test_identity_from_header_normalizes_and_validates(monkeypatch) -> None:
    monkeypatch.setattr(settings, "user_email_domain", "")
    assert _identity_from_header("SPINNG\\Jane.Doe") == ("jane.doe", "jane.doe", "Jane.Doe")
    assert _identity_from_header("DOMAIN/John_Smith") == ("john_smith", "john_smith", "John_Smith")
    # Empty / malformed values are rejected.
    assert _identity_from_header("") is None
    assert _identity_from_header("   ") is None
    assert _identity_from_header("has space") is None
    assert _identity_from_header("bad*char") is None


def test_resolve_admin_via_email_allowlist(monkeypatch) -> None:
    monkeypatch.setattr(settings, "dev_mode", False)
    monkeypatch.setattr(settings, "admin_emails", "boss@company.com")
    assert _resolve_admin("BOSS@company.com", "boss") is True
    assert _resolve_admin("intern@company.com", "intern") is False


def test_resolve_admin_via_username_allowlist(monkeypatch) -> None:
    monkeypatch.setattr(settings, "dev_mode", False)
    monkeypatch.setattr(settings, "admin_emails", "osahon.ero")
    assert _resolve_admin("osahon.ero@company.com", "Osahon.Ero") is True
    assert _resolve_admin("other@company.com", "other") is False


def test_resolve_admin_denies_without_allowlist(monkeypatch) -> None:
    monkeypatch.setattr(settings, "dev_mode", False)
    monkeypatch.setattr(settings, "admin_emails", "")
    assert _resolve_admin("nobody@company.com", "nobody") is False


def test_resolve_admin_dev_mode_grants(monkeypatch) -> None:
    monkeypatch.setattr(settings, "dev_mode", True)
    assert _resolve_admin("anyone@company.com", "anyone") is True
