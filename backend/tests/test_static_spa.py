"""Single-origin frontend serving (STATIC_DIR): uvicorn serves the SPA itself."""
from pathlib import Path

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.static_spa import mount_spa


def _spa_app(static_dir: Path) -> FastAPI:
    app = FastAPI()

    @app.get("/api/health")
    async def health() -> dict:
        return {"status": "ok"}

    assert mount_spa(app, str(static_dir)) is True
    return app


@pytest.mark.asyncio
async def test_serves_spa_without_shadowing_the_api(tmp_path: Path) -> None:
    (tmp_path / "index.html").write_text("<!doctype html><div id=root>APP_SHELL</div>")
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "app.js").write_text("console.log(1)")

    transport = ASGITransport(app=_spa_app(tmp_path))
    async with AsyncClient(transport=transport, base_url="http://t") as c:
        # The API still wins for its own paths.
        assert (await c.get("/api/health")).json() == {"status": "ok"}
        # An unmatched /api path is a real 404, NOT the app shell.
        miss = await c.get("/api/does-not-exist")
        assert miss.status_code == 404
        assert "APP_SHELL" not in miss.text
        # Root and deep client-side routes both fall back to index.html.
        assert "APP_SHELL" in (await c.get("/")).text
        assert "APP_SHELL" in (await c.get("/projects/abc/chart")).text
        # Real built assets are served from disk.
        assert (await c.get("/assets/app.js")).text == "console.log(1)"


@pytest.mark.asyncio
async def test_path_traversal_cannot_escape_the_static_root(tmp_path: Path) -> None:
    (tmp_path / "index.html").write_text("APP_SHELL")
    secret = tmp_path.parent / "secret.txt"
    secret.write_text("TOP_SECRET")

    transport = ASGITransport(app=_spa_app(tmp_path))
    async with AsyncClient(transport=transport, base_url="http://t") as c:
        r = await c.get("/../secret.txt")
        assert "TOP_SECRET" not in r.text  # never serves a file outside the root


@pytest.mark.asyncio
async def test_mount_is_a_noop_when_dir_missing() -> None:
    assert mount_spa(FastAPI(), "/no/such/dir/here") is False
