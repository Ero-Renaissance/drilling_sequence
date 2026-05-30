"""
Authentication dependency.

Dev mode (DEV_MODE=true):  any request is accepted; a "Dev User" is auto-created/returned.
Production:                Bearer token is validated against Azure AD via fastapi-azure-auth;
                           the user is upserted on first login.

Tests override get_current_user via app.dependency_overrides — no token needed.
"""

from functools import lru_cache
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.user import User

_DEV_CLAIMS = {
    "oid": "00000000-0000-0000-0000-000000000001",
    "name": "Dev User",
    "preferred_username": "dev@company.com",
}


@lru_cache(maxsize=1)
def _azure_scheme():
    """Build the Azure AD bearer validator once and reuse it.

    The validator lazily fetches and caches the tenant's OpenID config + JWKS on
    its instance, so constructing it per request would defeat that cache and hit
    Azure AD on every authenticated call. lru_cache pins a single instance for the
    process; it does not cache the ImportError, so an unconfigured install retries.
    """
    from fastapi_azure_auth import SingleTenantAzureAuthorizationCodeBearer  # type: ignore

    return SingleTenantAzureAuthorizationCodeBearer(
        app_client_id=settings.azure_client_id,
        tenant_id=settings.azure_tenant_id,
    )


async def _extract_claims(request: Request) -> dict:
    """Return token claims dict. In dev mode returns fixed dev claims."""
    if settings.dev_mode:
        return _DEV_CLAIMS

    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    try:
        azure_scheme = _azure_scheme()
    except ImportError:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="fastapi-azure-auth is not installed",
        )

    # fastapi-azure-auth validates the token signature, audience, and expiry.
    user_claims = await azure_scheme(request)  # raises 401 on invalid token
    return {
        "oid": user_claims.oid,
        "name": user_claims.name,
        "preferred_username": user_claims.preferred_username,
        "roles": getattr(user_claims, "roles", None) or [],
    }


def _resolve_admin(email: str, claims: dict) -> bool:
    """Decide whether a logging-in user is a global admin.

    Dev mode trusts the dev user. In production, an Azure AD app role (admin_role)
    in the token's "roles" claim is authoritative; admin_emails is a bootstrap
    allowlist for before that role is wired up.
    """
    if settings.dev_mode:
        return True
    if email and email.lower() in settings.admin_emails_list:
        return True
    roles = claims.get("roles") or []
    return bool(settings.admin_role) and settings.admin_role in roles


async def get_current_user(
    claims: Annotated[dict, Depends(_extract_claims)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    """Resolve token claims to a database User, creating the record on first login."""
    oid = claims["oid"]
    name = claims.get("name", "Unknown User")
    email = claims.get("preferred_username", "")
    is_admin = _resolve_admin(email, claims)

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
