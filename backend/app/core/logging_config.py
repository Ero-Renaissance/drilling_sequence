"""Structured logging + per-request correlation — stdlib only (see CLAUDE.md
LOGGING & OBSERVABILITY).

Plain, readable text in dev/test; one-JSON-object-per-line elsewhere for log
ingestion. Every record carries the current request's id so a single request's
logs are greppable. No third-party dependency (no loguru / asgi-correlation-id).
"""
import json
import logging
import uuid
from contextvars import ContextVar

from starlette.types import ASGIApp, Message, Receive, Scope, Send

# Per-request correlation id, injected into every log record for that request.
request_id_var: ContextVar[str] = ContextVar("request_id", default="-")

# The standard LogRecord attributes; anything else on a record is a caller `extra=`.
_STANDARD = frozenset(
    logging.LogRecord("", 0, "", 0, "", (), None).__dict__
) | {"request_id", "message", "asctime", "taskName"}


class RequestIdFilter(logging.Filter):
    """Attach the current request's id to every record so formatters can use it."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_var.get()
        return True


class JsonFormatter(logging.Formatter):
    """One JSON object per line: standard fields + request id + any `extra=` keys.
    Tracebacks go in `exc_info` as text. Never pass raw SQL / bound parameters as a
    log argument or extra — log the operation context only (see CLAUDE.md)."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, object] = {
            "ts": self.formatTime(record),
            "level": record.levelname,
            "logger": record.name,
            "request_id": getattr(record, "request_id", "-"),
            "message": record.getMessage(),
        }
        for key, value in record.__dict__.items():
            if key not in _STANDARD and not key.startswith("_"):
                payload[key] = value
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def configure_logging(*, level: str, json_logs: bool) -> None:
    """Install the request-id filter and the chosen formatter on the root handler."""
    logging.basicConfig(level=getattr(logging, level.upper(), logging.INFO))
    formatter: logging.Formatter = (
        JsonFormatter()
        if json_logs
        else logging.Formatter(
            "%(asctime)s %(levelname)s %(name)s [%(request_id)s] %(message)s"
        )
    )
    id_filter = RequestIdFilter()
    for handler in logging.getLogger().handlers:
        handler.setFormatter(formatter)
        handler.addFilter(id_filter)


class RequestIdMiddleware:
    """Pure-ASGI middleware: generate a request id, expose it via the contextvar so
    logs correlate, and echo it back as the `X-Request-ID` response header. The id is
    server-generated (never read from the client) so untrusted input can't reach the
    logs. Pure ASGI (not BaseHTTPMiddleware) so it never buffers streamed responses
    (e.g. static assets)."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        rid = uuid.uuid4().hex
        token = request_id_var.set(rid)

        async def send_with_id(message: Message) -> None:
            if message["type"] == "http.response.start":
                message.setdefault("headers", []).append((b"x-request-id", rid.encode()))
            await send(message)

        try:
            await self.app(scope, receive, send_with_id)
        finally:
            request_id_var.reset(token)
