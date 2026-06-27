"""Client-side log ingestion.

The browser's logger (`frontend/src/lib/logger.ts`) ships error-level events here
so they land in the same structured stdout stream as the backend, correlated by
request id — one place for operators to look on an internal deployment that has no
external monitoring service. This is client-supplied input, so it is validated and
bounded like any other request body: it can neither forge log lines nor bloat the
log, and only an authenticated user may write to the stream.
"""
import json
import logging
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.auth import get_current_user
from app.models.user import User

logger = logging.getLogger("app.client")

router = APIRouter(prefix="/api/client-logs", tags=["client-logs"])

_LEVEL_TO_LEVELNO = {
    "error": logging.ERROR,
    "warn": logging.WARNING,
    "info": logging.INFO,
}
_MAX_VALUE_CHARS = 1000
_MAX_CONTEXT_CHARS = 2000


class ClientLogEntry(BaseModel):
    """A single browser-reported log event. Treated as hostile input: a strict
    level allow-list, a bounded message, and a shallow scalar-only context whose
    size is capped (≤30 keys, each string value truncated)."""

    model_config = ConfigDict(extra="forbid")

    level: Literal["error", "warn", "info"] = "error"
    message: str = Field(min_length=1, max_length=2000)
    context: dict[str, str | int | float | bool | None] | None = Field(
        default=None, max_length=30
    )

    @field_validator("context")
    @classmethod
    def _bound_string_values(
        cls, value: dict[str, str | int | float | bool | None] | None
    ) -> dict[str, str | int | float | bool | None] | None:
        if not value:
            return value
        return {
            key: (item[:_MAX_VALUE_CHARS] if isinstance(item, str) else item)
            for key, item in value.items()
        }


@router.post("", status_code=status.HTTP_204_NO_CONTENT)
async def ingest_client_log(
    entry: ClientLogEntry,
    current_user: Annotated[User, Depends(get_current_user)],
) -> None:
    """Record a browser log event server-side at the matching level. Returns 204
    and echoes nothing back — fire-and-forget from the client's perspective. The
    request id (ASGI middleware) and the user id correlate it with the session."""
    # Collapse newlines so a crafted message can't forge extra lines in the
    # plain-text (dev) formatter; JSON output already escapes them. The user id is
    # an opaque identifier, not PII (per CLAUDE.md: log ids, not personal data).
    safe_message = " ".join(entry.message.splitlines())
    context_json = (
        json.dumps(entry.context, default=str)[:_MAX_CONTEXT_CHARS]
        if entry.context
        else ""
    )
    logger.log(
        _LEVEL_TO_LEVELNO[entry.level],
        "client: %s",
        safe_message,
        extra={
            "source": "client",
            "client_user_id": str(current_user.id),
            "client_context": context_json,
        },
    )
