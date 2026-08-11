"""
Authentication dependency.

Dev mode (DEV_MODE=true):  any request is accepted; a "Dev User" is auto-created/returned.
Production:                the request is authenticated by a reverse proxy (IIS/ARR doing
                           Windows Integrated Auth) that injects the authenticated Windows
                           account into a trusted header (settings.proxy_user_header). The
                           user is upserted on first login. The header is trusted only
                           because the app is reachable solely via the proxy (uvicorn bound
                           to loopback) and, optionally, a shared secret.

Tests override get_current_user via app.dependency_overrides — no header needed.
"""

import hmac
import logging
import re
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.user import User

logger = logging.getLogger(__name__)

# Header carrying the optional proxy shared secret (settings.proxy_shared_secret).
_PROXY_SECRET_HEADER = "X-Proxy-Auth"

# A normalized Windows account name: letters, digits, and . _ - only, length-
# bounded and anchored so a malformed/hostile header value can't slip through.
_USERNAME_RE = re.compile(r"^[a-z0-9._-]{1,256}$")

_DEV_CLAIMS = {
    "oid": "00000000-0000-0000-0000-000000000001",
    "name": "Dev User",
    "preferred_username": "dev@company.com",
    "username": "dev",
}


def _identity_from_header(raw: str) -> tuple[str, str, str] | None:
    """Parse the proxy's user header into (username, email, display).

    Accepts DOMAIN\\user, DOMAIN/user, a UPN (user@domain), or a bare username.
    Returns None when the value is empty or not a valid account name. username is
    the lowercased key; display keeps original case for the UI; email is the UPN
    when one was supplied, else synthesized from settings.user_email_domain.
    """
    value = (raw or "").strip()
    if not value:
        return None

    email = ""
    if "@" in value and "\\" not in value and "/" not in value:
        # UPN (user@domain): keep it as the email, local part seeds the username.
        display = value.split("@", 1)[0].strip()
        email = value.lower()
    else:
        # DOMAIN\user or DOMAIN/user (optionally with a stray UPN suffix).
        for sep in ("\\", "/"):
            if sep in value:
                value = value.rsplit(sep, 1)[1]
                break
        if "@" in value:
            value = value.split("@", 1)[0]
        display = value.strip()

    username = display.lower()
    if not _USERNAME_RE.match(username):
        return None
    if not email:
        email = (
            f"{username}@{settings.user_email_domain}"
            if settings.user_email_domain
            else username
        )
    return username, email, display


async def _extract_claims(request: Request) -> dict:
    """Return an identity claims dict. In dev mode returns fixed dev claims;
    otherwise derives identity from the trusted reverse-proxy header."""
    if settings.dev_mode:
        return _DEV_CLAIMS

    # Optional shared secret: reject anything that doesn't present it, so a forged
    # user header can't be trusted even if the app is reached directly. Constant-
    # time compare so the secret can't be recovered via response timing.
    if settings.proxy_shared_secret:
        presented = request.headers.get(_PROXY_SECRET_HEADER, "")
        if not hmac.compare_digest(presented, settings.proxy_shared_secret):
            logger.warning(
                "Proxy shared-secret missing/mismatched (%s %s)",
                request.method,
                request.url.path,
            )
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
            )

    header_name = settings.proxy_user_header
    identity = (
        _identity_from_header(request.headers.get(header_name, "")) if header_name else None
    )
    if identity is None:
        # Never reveal whether the header was absent vs malformed, and never log
        # the value itself — just that this request couldn't be attributed.
        logger.warning(
            "Proxy user header missing/invalid (%s %s)",
            request.method,
            request.url.path,
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
        )

    username, email, display = identity
    return {
        "oid": username,  # stable subject key (single-domain assumption)
        "name": display,
        "preferred_username": email,
        "username": username,
    }


def _resolve_admin(email: str, username: str) -> bool:
    """Decide whether a logging-in user is a global admin.

    Dev mode trusts the dev user. In production, admin is granted when the user's
    email OR their Windows username appears in the admin_emails allowlist. Sign-in
    carries no role claims, so the allowlist is the sole login-time source; grants
    made on the Admin page are additive and preserved by get_current_user.
    """
    if settings.dev_mode:
        return True
    allow = settings.admin_emails_list  # already lowercased
    if email and email.lower() in allow:
        return True
    return bool(username) and username.lower() in allow


async def get_current_user(
    claims: Annotated[dict, Depends(_extract_claims)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    """Resolve token claims to a database User, creating the record on first login."""
    oid = claims["oid"]
    name = claims.get("name", "Unknown User")
    email = claims.get("preferred_username", "")
    is_admin = _resolve_admin(email, claims.get("username", ""))

    result = await db.execute(select(User).where(User.ad_object_id == oid))
    user = result.scalar_one_or_none()

    if user is None:
        user = User(ad_object_id=oid, name=name, email=email, is_admin=is_admin)
        db.add(user)
        await db.commit()
        await db.refresh(user)
    else:
        # Claims/allowlist are a floor: they can grant admin but never revoke a grant
        # made in the admin page, so manual changes aren't wiped on next login.
        new_is_admin = user.is_admin or is_admin
        if user.name != name or user.email != email or user.is_admin != new_is_admin:
            user.name = name
            user.email = email
            user.is_admin = new_is_admin
            await db.commit()
            await db.refresh(user)

    return user


async def get_current_admin(
    user: Annotated[User, Depends(get_current_user)],
) -> User:
    """Require the current user to be a global admin."""
    if not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required"
        )
    return user
