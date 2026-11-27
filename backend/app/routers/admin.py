import logging
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.auth import get_current_admin, on_admin_allowlist
from app.database import get_db
from app.models.project import ProjectMember
from app.models.readiness import UserTeamGrant
from app.models.user import User
from app.schemas.admin import AdminUserCreate, AdminUserResponse, AdminUserUpdate
from app.services.audit import ENTITY_USER, governance_event

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin", tags=["admin"])

CurrentAdmin = Annotated[User, Depends(get_current_admin)]
DB = Annotated[AsyncSession, Depends(get_db)]


@router.get("/users", response_model=list[AdminUserResponse])
async def list_users(_admin: CurrentAdmin, db: DB) -> list[AdminUserResponse]:
    """List every user with their global-admin flag and project-membership count."""
    counts = dict(
        (
            await db.execute(
                select(ProjectMember.user_id, func.count(ProjectMember.id)).group_by(
                    ProjectMember.user_id
                )
            )
        ).all()
    )
    users = (
        await db.execute(select(User).order_by(User.name))
    ).scalars().all()
    teams_by_user: dict[uuid.UUID, list[str]] = {}
    for user_id, team_code in (
        await db.execute(
            select(UserTeamGrant.user_id, UserTeamGrant.team_code).order_by(
                UserTeamGrant.team_code
            )
        )
    ).all():
        teams_by_user.setdefault(user_id, []).append(team_code)
    return [
        AdminUserResponse(
            id=u.id,
            name=u.name,
            email=u.email,
            is_admin=u.is_admin,
            can_plan=u.can_plan,
            project_count=counts.get(u.id, 0),
            admin_via_allowlist=on_admin_allowlist(u.email, u.ad_object_id),
            teams=teams_by_user.get(u.id, []),
            is_active=u.is_active,
        )
        for u in users
    ]


@router.post("/users", response_model=AdminUserResponse, status_code=status.HTTP_201_CREATED)
async def add_user(payload: AdminUserCreate, admin: CurrentAdmin, db: DB) -> AdminUserResponse:
    """Add a person to the pilot sign-in list (PILOT_MODE only). Under Windows
    sign-in people appear by themselves the first time they open the app, so
    there is nothing to add (409). The new person is a viewer until granted more."""
    if not settings.pilot_mode:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="People are added automatically the first time they sign in",
        )
    email = f"{payload.username}@{settings.user_email_domain.strip().lower()}"
    existing = (
        await db.execute(
            select(User.id).where(
                or_(User.ad_object_id == payload.username, func.lower(User.email) == email)
            )
        )
    ).first()
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="This person is already on the list"
        )
    user = User(ad_object_id=payload.username, name=payload.name, email=email)
    db.add(user)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="This person is already on the list"
        ) from None
    db.add(
        governance_event(
            project_id=None,
            user_id=admin.id,
            entity_type=ENTITY_USER,
            entity_id=user.id,
            action="user_added",
            detail=f"Added {user.email} to the sign-in list (by {admin.email})",
        )
    )
    await db.commit()
    await db.refresh(user)
    logger.info("user_added actor_id=%s target_id=%s", admin.id, user.id)
    return AdminUserResponse(
        id=user.id,
        name=user.name,
        email=user.email,
        is_admin=user.is_admin,
        can_plan=user.can_plan,
        project_count=0,
        admin_via_allowlist=on_admin_allowlist(user.email, user.ad_object_id),
        teams=[],
        is_active=user.is_active,
    )


@router.patch("/users/{user_id}", response_model=AdminUserResponse)
async def update_user(
    user_id: uuid.UUID,
    payload: AdminUserUpdate,
    admin: CurrentAdmin,
    db: DB,
) -> AdminUserResponse:
    """Grant or revoke global privileges: `is_admin` and/or `can_plan` (the
    global planner grant), and block or unblock sign-in (`is_active`). An admin
    cannot revoke their own admin access or block themselves (prevents locking
    the last admin out)."""
    if user_id == admin.id and payload.is_admin is False:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot revoke your own admin access",
        )
    if user_id == admin.id and payload.is_active is False:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot block your own sign-in",
        )

    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    # The allowlist (admin_emails) is a floor: it re-grants admin at every login, so a
    # manual revoke here wouldn't stick. Reject it with a clear, actionable message.
    # Matched as sign-in matches it: by email or by username.
    via_allowlist = on_admin_allowlist(user.email, user.ad_object_id)
    if payload.is_admin is False and via_allowlist:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "This user is an admin via the email allowlist; "
                "remove them from admin_emails to revoke."
            ),
        )

    # ADMIN_EMAILS is configuration: blocking someone it names would contradict
    # it, so that too is changed in the allowlist first.
    if payload.is_active is False and via_allowlist:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "This user is an admin via the email allowlist; "
                "remove them from admin_emails to block them."
            ),
        )

    previous_admin = user.is_admin
    previous_plan = user.can_plan
    previous_active = user.is_active
    if payload.is_admin is not None:
        user.is_admin = payload.is_admin
    if payload.can_plan is not None:
        user.can_plan = payload.can_plan
    if payload.is_active is not None:
        user.is_active = payload.is_active

    # Privilege changes are governance events: record them in the append-only
    # audit table (project_id NULL = global event) IN the same transaction as
    # the grant, so the durable trail can never miss a change that committed.
    # The audit detail carries the emails; the process log below sticks to ids
    # (no PII in logs).
    if previous_admin != user.is_admin:
        db.add(
            governance_event(
                project_id=None,
                user_id=admin.id,
                entity_type=ENTITY_USER,
                entity_id=user.id,
                action="admin_granted" if user.is_admin else "admin_revoked",
                detail=(
                    f"{'Granted' if user.is_admin else 'Revoked'} global admin "
                    f"for {user.email} (by {admin.email})"
                ),
                old_value=str(previous_admin),
            )
        )
    if previous_plan != user.can_plan:
        db.add(
            governance_event(
                project_id=None,
                user_id=admin.id,
                entity_type=ENTITY_USER,
                entity_id=user.id,
                action="can_plan_granted" if user.can_plan else "can_plan_revoked",
                detail=(
                    f"{'Granted' if user.can_plan else 'Revoked'} the planning "
                    f"grant for {user.email} (by {admin.email})"
                ),
                old_value=str(previous_plan),
            )
        )
    if previous_active != user.is_active:
        db.add(
            governance_event(
                project_id=None,
                user_id=admin.id,
                entity_type=ENTITY_USER,
                entity_id=user.id,
                action="user_unblocked" if user.is_active else "user_blocked",
                detail=(
                    f"{'Allowed' if user.is_active else 'Blocked'} sign-in "
                    f"for {user.email} (by {admin.email})"
                ),
                old_value=str(previous_active),
            )
        )
    await db.commit()
    await db.refresh(user)

    if previous_active != user.is_active:
        logger.info(
            "user_sign_in_change actor_id=%s target_id=%s is_active=%s->%s",
            admin.id,
            user.id,
            previous_active,
            user.is_active,
        )
    if previous_admin != user.is_admin:
        logger.info(
            "admin_privilege_change actor_id=%s target_id=%s is_admin=%s->%s",
            admin.id,
            user.id,
            previous_admin,
            user.is_admin,
        )
    if previous_plan != user.can_plan:
        logger.info(
            "planner_grant_change actor_id=%s target_id=%s can_plan=%s->%s",
            admin.id,
            user.id,
            previous_plan,
            user.can_plan,
        )

    count = (
        await db.execute(
            select(func.count(ProjectMember.id)).where(ProjectMember.user_id == user.id)
        )
    ).scalar_one()
    return AdminUserResponse(
        id=user.id,
        name=user.name,
        email=user.email,
        is_admin=user.is_admin,
        can_plan=user.can_plan,
        project_count=count,
        admin_via_allowlist=via_allowlist,
        is_active=user.is_active,
        teams=list(
            (
                await db.execute(
                    select(UserTeamGrant.team_code)
                    .where(UserTeamGrant.user_id == user.id)
                    .order_by(UserTeamGrant.team_code)
                )
            ).scalars()
        ),
    )
