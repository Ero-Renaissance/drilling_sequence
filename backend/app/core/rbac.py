import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.approver import ProjectApprover
from app.models.project import ProjectMember, ProjectRole
from app.models.user import User


async def assert_member(
    project_id: uuid.UUID,
    user: User,
    db: AsyncSession,
    allowed_roles: set[ProjectRole] | None = None,
) -> None:
    """Ensure `user` may act on `project_id`.

    Global admins always pass. Otherwise the user must be a ProjectMember, and
    — when `allowed_roles` is given — hold one of those roles.
    """
    if user.is_admin:  # global admins bypass project membership
        return
    result = await db.execute(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == user.id,
        )
    )
    member = result.scalar_one_or_none()
    if member is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    if allowed_roles is not None and member.role not in allowed_roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient role for this action",
        )


async def assert_can_sign(
    project_id: uuid.UUID, user: User, db: AsyncSession
) -> None:
    """A revision may be signed by a global admin, a designated approver for the
    project (matched by email), or a non-viewer project member."""
    if user.is_admin:
        return
    if user.email:
        approver = await db.execute(
            select(ProjectApprover).where(
                ProjectApprover.project_id == project_id,
                ProjectApprover.email == user.email.lower(),
            )
        )
        if approver.scalar_one_or_none() is not None:
            return
    result = await db.execute(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == user.id,
        )
    )
    member = result.scalar_one_or_none()
    if member is None or member.role == ProjectRole.viewer:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
