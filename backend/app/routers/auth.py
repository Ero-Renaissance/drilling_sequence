import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.auth import _USERNAME_RE, get_current_user, on_admin_allowlist
from app.core.pilot import (
    COOKIE_NAME,
    begin_sign_in_attempt,
    forgive_sign_in_attempt,
    issue_session,
    passcode_matches,
    session_max_age,
)
from app.database import get_db
from app.models.readiness import UserTeamGrant
from app.models.user import User
from app.schemas.user import SignInOptions, SignInRequest, UserResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])
# Reachable WITHOUT a signed-in user (main.py includes it with no auth
# dependency): the sign-in screen's options, sign-in itself and sign-out.
public_router = APIRouter(prefix="/api/auth", tags=["auth"])

DB = Annotated[AsyncSession, Depends(get_db)]

# One message for every refusal: it never says whether the name is on the list,
# is blocked, or only lacked the passcode.
_SIGN_IN_FAILED = (
    "Sign-in failed. Check your name; planners and administrators must also "
    "enter the passcode."
)
_TOO_MANY_ATTEMPTS = "Too many sign-in attempts. Try again in 15 minutes."


async def _team_codes(user: User, db: AsyncSession) -> list[str]:
    return list(
        (
            await db.execute(
                select(UserTeamGrant.team_code)
                .where(UserTeamGrant.user_id == user.id)
                .order_by(UserTeamGrant.team_code)
            )
        ).scalars()
    )


async def _profile(user: User, db: AsyncSession) -> UserResponse:
    response = UserResponse.model_validate(user)
    response.teams = await _team_codes(user, db)
    return response


@router.get("/me", response_model=UserResponse)
async def get_me(
    current_user: Annotated[User, Depends(get_current_user)],
    db: DB,
) -> UserResponse:
    """Return the authenticated user's profile, with their readiness team grants."""
    return await _profile(current_user, db)


@public_router.get("/options", response_model=SignInOptions)
async def sign_in_options() -> SignInOptions:
    """How this deployment signs people in, for the sign-in screen. Public: it
    says nothing the sign-in screen itself doesn't show."""
    return SignInOptions(
        sign_in=settings.sign_in_mode,
        email_domain=settings.user_email_domain.strip().lower() if settings.pilot_mode else None,
        approvals_enabled=settings.approvals_enabled,
        session_days=settings.pilot_session_days if settings.pilot_mode else None,
    )


def _short_name(raw: str) -> str | None:
    """The part before the "@", lowercased. The full address is accepted only
    for the company domain; anything else (or a malformed name) is None."""
    value = raw.strip().lower()
    if "@" in value:
        local, _, domain = value.partition("@")
        if domain != settings.user_email_domain.strip().lower():
            return None
        value = local
    return value if _USERNAME_RE.match(value) else None


def _refuse(reason: str) -> HTTPException:
    """The one generic refusal. The attempt was counted when it began
    (begin_sign_in_attempt) and stays counted. The log carries the reason code
    only — never the name that was typed."""
    logger.warning("Pilot sign-in refused (reason=%s)", reason)
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_SIGN_IN_FAILED)


@public_router.post("/sign-in", response_model=UserResponse)
async def sign_in(payload: SignInRequest, response: Response, db: DB) -> UserResponse:
    """Pilot sign-in (PILOT_MODE only; 404 otherwise).

    The name must be on the admin-kept list (an active user) or in ADMIN_EMAILS.
    Anyone who can edit or administer — an admin, a planner, a readiness team
    editor — must also give the shared passcode; a passcode that is sent must be
    right for everyone. Success sets the session cookie.
    """
    if not settings.pilot_mode:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    name = _short_name(payload.username)
    throttle_key = name or "?"
    # Counted NOW, before anything is awaited: requests sent in a burst are each
    # counted before any of them reaches the passcode check. Only a sign-in that
    # succeeds gets its count back.
    if not begin_sign_in_attempt(throttle_key):
        logger.warning("Pilot sign-in refused (reason=throttled)")
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=_TOO_MANY_ATTEMPTS
        )
    if name is None:
        raise _refuse("bad_name")

    email = f"{name}@{settings.user_email_domain.strip().lower()}"
    allowlisted = on_admin_allowlist(email, name)

    user = (
        await db.execute(select(User).where(User.ad_object_id == name))
    ).scalar_one_or_none()
    if user is None:
        user = (
            await db.execute(select(User).where(func.lower(User.email) == email))
        ).scalar_one_or_none()

    if user is None and not allowlisted:
        raise _refuse("not_listed")
    if user is not None and not user.is_active:
        raise _refuse("blocked")

    passcode_ok = passcode_matches(payload.passcode)
    if payload.passcode is not None and not passcode_ok:
        raise _refuse("passcode")
    can_edit = allowlisted or (
        user is not None
        and (user.is_admin or user.can_plan or bool(await _team_codes(user, db)))
    )
    if can_edit and not passcode_ok:
        raise _refuse("passcode_required")

    if user is None:
        # First sign-in of an ADMIN_EMAILS admin: the one account nobody has to
        # add by hand, so the list can be started.
        user = User(ad_object_id=name, name=name, email=email, is_admin=True)
        db.add(user)
    elif allowlisted and not user.is_admin:
        user.is_admin = True  # the allowlist is a floor, as under Windows sign-in
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise _refuse("conflict") from None
    await db.refresh(user)

    forgive_sign_in_attempt(throttle_key)
    response.set_cookie(
        COOKIE_NAME,
        issue_session(user.ad_object_id, passcode_verified=passcode_ok),
        max_age=session_max_age(),
        httponly=True,
        samesite="strict",
        secure=settings.app_base_url.strip().lower().startswith("https://"),
        path="/",
    )
    logger.info("pilot_sign_in user_id=%s passcode=%s", user.id, passcode_ok)
    return await _profile(user, db)


@public_router.post("/sign-out", status_code=status.HTTP_204_NO_CONTENT)
async def sign_out(response: Response) -> None:
    """Forget this browser's pilot session. Harmless in every other mode."""
    response.delete_cookie(COOKIE_NAME, path="/", httponly=True, samesite="strict")
