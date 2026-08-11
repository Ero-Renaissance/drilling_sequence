"""Cross-site request protection for the reverse-proxy (Windows Integrated Auth)
deployment.

With bearer tokens, credentials only ever rode in a header the SPA set
explicitly, so cross-site request forgery was structurally impossible. Ambient
Windows auth changes that: a domain-joined browser auto-negotiates the user's
credentials to the intranet host for ANY request to it — including one a hostile
external page triggers. CORS preflight already protects JSON-body and custom-
header endpoints, but a plain cross-site `<form method=post>` reaches a no-body
POST (e.g. .../complete, .../reopen) with the victim's SSO and no preflight.

Defence: reject an unsafe-method request whose `Sec-Fetch-Site` says it came
from another site. Every browser that auto-negotiates Windows auth also sends
this header (it predates the Negotiate handshake by years), and the SPA is
served same-origin with the API, so legitimate calls are `same-origin`. Requests
with no `Sec-Fetch-Site` (non-browser callers: the proxy health probe, ops
tooling, the test client) are allowed — they carry no ambient browser session to
abuse. This is a same-origin gate, not a token scheme, so it needs no per-request
state and never touches the response body (pure ASGI, like RequestIdMiddleware).
"""
import json
from typing import ClassVar

from starlette.types import ASGIApp, Receive, Scope, Send

# Methods that can change state and therefore need the cross-site check. Safe
# methods (GET/HEAD/OPTIONS) are read-only or the CORS preflight itself.
_UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})

# Sec-Fetch-Site values that are NOT the app's own origin. "cross-site" is an
# unrelated site; "same-site" is a different subdomain of the same registrable
# domain (e.g. evil.corp.example → app.corp.example) — still not us.
_FOREIGN_SITES = frozenset({b"cross-site", b"same-site"})


class SameOriginMiddleware:
    """Reject unsafe-method requests that a browser reports as coming from
    another site (`Sec-Fetch-Site: cross-site` / `same-site`). Absent header =
    allowed (non-browser caller). Pure ASGI so it never buffers responses."""

    _DENIED: ClassVar[bytes] = json.dumps({"detail": "Cross-site request blocked"}).encode()

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] not in _UNSAFE_METHODS:
            await self.app(scope, receive, send)
            return

        site = None
        for name, value in scope["headers"]:
            if name == b"sec-fetch-site":
                site = value.strip().lower()
                break

        if site in _FOREIGN_SITES:
            await self._forbid(send)
            return

        await self.app(scope, receive, send)

    async def _forbid(self, send: Send) -> None:
        await send(
            {
                "type": "http.response.start",
                "status": 403,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(self._DENIED)).encode()),
                ],
            }
        )
        await send({"type": "http.response.body", "body": self._DENIED})
