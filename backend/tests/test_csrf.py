"""Cross-site guard (app.core.security.SameOriginMiddleware).

Under ambient Windows auth the browser attaches the user's SSO to any request
to this host, so a hostile page could forge a no-body state-changing POST. The
middleware rejects unsafe-method requests a browser reports as cross-site via
Sec-Fetch-Site; absent header (non-browser callers, including this test client
elsewhere) is allowed.
"""
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_cross_site_post_is_blocked(client: AsyncClient) -> None:
    r = await client.post(
        "/api/projects",
        json={"name": "Forged"},
        headers={"Sec-Fetch-Site": "cross-site"},
    )
    assert r.status_code == 403
    assert r.json()["detail"] == "Cross-site request blocked"
    # Blocked BEFORE the handler runs — nothing was created.
    listing = await client.get("/api/projects")
    assert all(p["name"] != "Forged" for p in listing.json())


@pytest.mark.asyncio
async def test_same_site_post_is_blocked(client: AsyncClient) -> None:
    # A sibling subdomain (evil.corp → app.corp) is still not us.
    r = await client.post(
        "/api/projects",
        json={"name": "Sibling"},
        headers={"Sec-Fetch-Site": "same-site"},
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_same_origin_post_passes_the_guard(client: AsyncClient) -> None:
    r = await client.post(
        "/api/projects",
        json={"name": "Legit Same-Origin"},
        headers={"Sec-Fetch-Site": "same-origin"},
    )
    assert r.status_code == 201, r.text


@pytest.mark.asyncio
async def test_post_without_sec_fetch_site_is_allowed(client: AsyncClient) -> None:
    # Non-browser callers (the proxy probe, ops tooling, this test suite) send no
    # Sec-Fetch-Site and carry no ambient browser session to abuse.
    r = await client.post("/api/projects", json={"name": "No Sec-Fetch"})
    assert r.status_code == 201, r.text


@pytest.mark.asyncio
async def test_safe_method_is_never_blocked(client: AsyncClient) -> None:
    # A cross-site GET is not state-changing — the guard must not touch it.
    r = await client.get("/api/projects", headers={"Sec-Fetch-Site": "cross-site"})
    assert r.status_code == 200
