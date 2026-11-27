"""Pilot sign-in: the session cookie, the sign-in throttle and the approvals switch.

Pilot mode (settings.pilot_mode, docs/deployment-guide.md Appendix E) is a
stop-gap for a deployment without Windows sign-in. A person on the admin-kept
list signs in with the part of their email before the "@"; anyone who can edit
or administer must also give the shared passcode. The browser then holds a
signed session cookie.

The cookie is ``v1.<payload>.<signature>``: the payload is base64url JSON
``{"u": <users.ad_object_id>, "p": 0|1, "exp": <epoch seconds>}`` and the
signature is HMAC-SHA256 over ``v1.<payload>`` with PILOT_SESSION_SECRET. It
carries no secret and is HttpOnly + SameSite=Strict, so a script can't read it
and another site can't ride it. ``p`` records whether the passcode was given: a
session without it is read-only (app/core/auth.py).

Stdlib only (hmac / hashlib / base64 / json) — no session or signing package.
"""

import base64
import binascii
import hashlib
import hmac
import json
import time
from dataclasses import dataclass

from fastapi import HTTPException, status

from app.config import settings

COOKIE_NAME = "ds_session"
_VERSION = "v1"
# A real cookie is ~120 characters; anything far longer is not ours.
_MAX_TOKEN_CHARS = 1024

APPROVALS_OFF_DETAIL = "Approvals are not available in this deployment"


@dataclass(frozen=True)
class PilotSession:
    subject: str  # users.ad_object_id
    passcode_verified: bool
    expires_at: int


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _sign(signed_part: str) -> str:
    key = settings.pilot_session_secret.encode("utf-8")
    return _b64(hmac.new(key, signed_part.encode("ascii"), hashlib.sha256).digest())


def session_max_age() -> int:
    return settings.pilot_session_days * 86400


def issue_session(subject: str, *, passcode_verified: bool, now: float | None = None) -> str:
    """A signed session token for `subject`, valid for PILOT_SESSION_DAYS."""
    issued = time.time() if now is None else now
    payload = {
        "u": subject,
        "p": 1 if passcode_verified else 0,
        "exp": int(issued) + session_max_age(),
    }
    body = _b64(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signed_part = f"{_VERSION}.{body}"
    return f"{signed_part}.{_sign(signed_part)}"


def read_session(token: str | None, now: float | None = None) -> PilotSession | None:
    """The session a cookie carries, or None when it is missing, malformed,
    forged or expired. Never raises: every bad cookie reads as "not signed in"."""
    if not token or len(token) > _MAX_TOKEN_CHARS or not settings.pilot_session_secret:
        return None
    # Ours is ASCII throughout. A non-ASCII one would make the signing and the
    # constant-time compare below raise, so it is refused here instead.
    if not token.isascii():
        return None
    parts = token.split(".")
    if len(parts) != 3 or parts[0] != _VERSION:
        return None
    signed_part = f"{parts[0]}.{parts[1]}"
    # Signature first, constant-time, before any of the payload is trusted.
    if not hmac.compare_digest(_sign(signed_part), parts[2]):
        return None
    try:
        payload = json.loads(_unb64(parts[1]))
    except (ValueError, binascii.Error, UnicodeDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    subject, verified, expires = payload.get("u"), payload.get("p"), payload.get("exp")
    if not isinstance(subject, str) or not subject or len(subject) > 256:
        return None
    if verified not in (0, 1) or not isinstance(expires, int) or isinstance(expires, bool):
        return None
    current = time.time() if now is None else now
    if expires <= current:
        return None
    return PilotSession(subject=subject, passcode_verified=verified == 1, expires_at=expires)


def passcode_matches(presented: str | None) -> bool:
    """Constant-time passcode check. A blank configured passcode never matches."""
    expected = settings.pilot_passcode
    if not presented or not expected:
        return False
    return hmac.compare_digest(presented.encode("utf-8"), expected.encode("utf-8"))


# ---------------------------------------------------------------------------
# Sign-in throttle. Owned and in-process (per the dependency rule), which
# matches the single-process internal deployment. Failed attempts are counted
# per name AND overall in a fixed window, because the passcode is shared: a
# guesser could otherwise spread attempts across every name on the list. A
# lock-out only refuses NEW sign-ins — sessions already issued keep working.
# ---------------------------------------------------------------------------
THROTTLE_WINDOW_SECONDS = 15 * 60.0
MAX_FAILURES_PER_NAME = 5
MAX_FAILURES_OVERALL = 50
_MAX_TRACKED_NAMES = 5000

_failures_by_name: dict[str, tuple[float, int]] = {}
_failures_overall: tuple[float, int] | None = None


def _count(entry: tuple[float, int] | None, now: float) -> int:
    if entry is None or now - entry[0] >= THROTTLE_WINDOW_SECONDS:
        return 0
    return entry[1]


def sign_in_throttled(name: str, now: float | None = None) -> bool:
    current = time.monotonic() if now is None else now
    if _count(_failures_overall, current) >= MAX_FAILURES_OVERALL:
        return True
    return _count(_failures_by_name.get(name), current) >= MAX_FAILURES_PER_NAME


def record_sign_in_failure(name: str, now: float | None = None) -> None:
    global _failures_overall
    current = time.monotonic() if now is None else now

    def bump(entry: tuple[float, int] | None) -> tuple[float, int]:
        if entry is None or current - entry[0] >= THROTTLE_WINDOW_SECONDS:
            return (current, 1)
        return (entry[0], entry[1] + 1)

    _failures_overall = bump(_failures_overall)
    if name not in _failures_by_name and len(_failures_by_name) >= _MAX_TRACKED_NAMES:
        # Bound the table: drop expired windows; if it is still full, stop
        # tracking new names (the overall cap still applies to them).
        for key in [k for k, v in _failures_by_name.items() if _count(v, current) == 0]:
            del _failures_by_name[key]
        if len(_failures_by_name) >= _MAX_TRACKED_NAMES:
            return
    _failures_by_name[name] = bump(_failures_by_name.get(name))


def begin_sign_in_attempt(name: str, now: float | None = None) -> bool:
    """Count one sign-in attempt for `name`, or return False when it is locked
    out. The check and the count happen together, with nothing awaited between
    them, so a burst of requests sent at once can't all pass the check before
    any failure is counted. A sign-in that then succeeds gives its count back
    (`forgive_sign_in_attempt`); a refused one keeps it."""
    if sign_in_throttled(name, now):
        return False
    record_sign_in_failure(name, now)
    return True


def forgive_sign_in_attempt(name: str, now: float | None = None) -> None:
    """Give back the count `begin_sign_in_attempt` took: the sign-in succeeded."""
    global _failures_overall
    current = time.monotonic() if now is None else now
    if _count(_failures_overall, current) > 0 and _failures_overall is not None:
        _failures_overall = (_failures_overall[0], _failures_overall[1] - 1)
    entry = _failures_by_name.get(name)
    if entry is not None and _count(entry, current) > 0:
        if entry[1] <= 1:
            del _failures_by_name[name]
        else:
            _failures_by_name[name] = (entry[0], entry[1] - 1)


def reset_throttle() -> None:
    """Forget every counted failure (tests)."""
    global _failures_overall
    _failures_by_name.clear()
    _failures_overall = None


def assert_approvals_enabled() -> None:
    """Route dependency for submit / sign / decline: refused while pilot sign-in
    is on, because a name anyone can type is no basis for a signature. The UI
    hides these actions; this is the control."""
    if not settings.approvals_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=APPROVALS_OFF_DETAIL)
