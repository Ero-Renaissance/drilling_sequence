"""The global exception handler is exercised on a throwaway app (so we never ship
a deliberate crash route in the real app) that reuses the production handler.
"""

import logging

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.main import unhandled_exception_handler


@pytest.mark.asyncio
async def test_unhandled_exception_returns_generic_500(caplog) -> None:
    app = FastAPI()
    app.add_exception_handler(Exception, unhandled_exception_handler)

    @app.get("/boom")
    async def boom():
        raise RuntimeError("super secret stack detail")

    transport = ASGITransport(app=app, raise_app_exceptions=False)
    with caplog.at_level(logging.ERROR, logger="app"):
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/boom")

    # Client sees a generic message — no internals.
    assert response.status_code == 500
    assert response.json() == {"detail": "Internal server error"}
    assert "super secret" not in response.text

    # The detail is logged server-side instead.
    assert "Unhandled error" in caplog.text
