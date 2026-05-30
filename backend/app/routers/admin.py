import logging
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_admin
from app.database import get_db
from app.models.project import ProjectMember
from app.models.user import User
from app.schemas.admin import AdminUserResponse, AdminUserUpdate

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
    return [
        AdminUserResponse(
            id=u.id,
            name=u.name,
            email=u.email,
            is_admin=u.is_admin,
            project_count=counts.get(u.id, 0),
        )
        for u in users
    ]


@router.patch("/users/{user_id}", response_model=AdminUserResponse)
async def update_user(
    user_id: uuid.UUID,
    payload: AdminUserUpdate,
    admin: CurrentAdmin,
    db: DB,
) -> AdminUserResponse:
    """Grant or revoke global admin. An admin cannot revoke their own access
    (prevents locking the last admin out)."""
    if user_id == admin.id and not payload.is_admin:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot revoke your own admin access",
        )

    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    previous = user.is_admin
    user.is_admin = payload.is_admin
    await db.commit()
    await db.refresh(user)

    # Global admin changes are high-privilege and rare; record a defensible,
    # server-side trail (the project-scoped audit log can't hold a global event).
    if previous != user.is_admin:
        logger.info(
            "admin_privilege_change actor=%s actor_id=%s target=%s target_id=%s is_admin=%s->%s",
            admin.email,
            admin.id,
            user.email,
            user.id,
            previous,
            user.is_admin,
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
        project_count=count,
    )
