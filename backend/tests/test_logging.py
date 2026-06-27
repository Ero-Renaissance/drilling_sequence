"""Structured logging + per-request correlation id."""
import json
import logging
import sys

import pytest
from httpx import AsyncClient

from app.core.logging_config import JsonFormatter, RequestIdFilter, request_id_var


def test_json_formatter_emits_structured_record() -> None:
    record = logging.LogRecord(
        "app.test", logging.INFO, __file__, 10, "hello %s", ("world",), None
    )
    record.request_id = "abc123"
    record.project_id = "p-1"  # a caller `extra=` survives into the JSON
    data = json.loads(JsonFormatter().format(record))
    assert data["level"] == "INFO"
    assert data["logger"] == "app.test"
    assert data["message"] == "hello world"
    assert data["request_id"] == "abc123"
    assert data["project_id"] == "p-1"


def test_json_formatter_includes_traceback_text() -> None:
    try:
        raise ValueError("boom")
    except ValueError:
        record = logging.LogRecord(
            "app", logging.ERROR, __file__, 1, "failed", (), sys.exc_info()
        )
    data = json.loads(JsonFormatter().format(record))
    assert "ValueError: boom" in data["exc_info"]


def test_request_id_filter_attaches_contextvar() -> None:
    token = request_id_var.set("xyz")
    try:
        record = logging.LogRecord("app", logging.INFO, __file__, 1, "m", (), None)
        assert RequestIdFilter().filter(record) is True
        assert record.request_id == "xyz"
    finally:
        request_id_var.reset(token)


@pytest.mark.asyncio
async def test_response_carries_a_request_id_header(client: AsyncClient) -> None:
    r = await client.get("/api/health")
    assert r.status_code == 200
    assert r.headers.get("X-Request-ID")
