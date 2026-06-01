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


async def assert_can_view(
    project_id: uuid.UUID, user: User, db: AsyncSession
) -> None:
    """Read access to a project's plan and revision diffs.

    Broader than membership on purpose: a designated approver is matched by email
    and may not be a ProjectMember, yet must be able to review the changes they're
    being asked to approve. Allowed: a global admin, a designated approver
    (by lowercased email), or any project member (including a viewer).
    """
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
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")


async def assert_can_sign(
    project_id: uuid.UUID, user: User, db: AsyncSession
) -> None:
    """A revision's binding approval may be signed only by a global admin or a
    designated approver for the project (matched by lowercased email).

    Project membership alone no longer grants signing rights: approval authority
    is the designated-approver matrix, not a side effect of being a non-viewer
    member. This keeps recorded signatures to people with real sign-off authority.
    Separation of duties (the submitter can't approve their own revision) is
    enforced at the endpoint, which has the revision in hand."""
    if user.is_admin:
        return
    if user.email:
        approver = await db.execute(
            select(ProjectApprover).where(
                ProjectApprover.project_id == project_id,
                ProjectApprover.email == user.email.lower(),
                ProjectApprover.kind == "approver",
            )
        )
        if approver.scalar_one_or_none() is not None:
            return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")


async def assert_can_review(
    project_id: uuid.UUID, user: User, db: AsyncSession
) -> None:
    """The technical-review stage may be actioned only by a global admin or a
    designated reviewer for the project (matched by lowercased email,
    `kind="reviewer"`). Mirrors `assert_can_sign` one stage earlier. Separation
    of duties (the submitter can't review their own revision) is enforced at the
    endpoint, which has the revision in hand."""
    if user.is_admin:
        return
    if user.email:
        reviewer = await db.execute(
            select(ProjectApprover).where(
                ProjectApprover.project_id == project_id,
                ProjectApprover.email == user.email.lower(),
                ProjectApprover.kind == "reviewer",
            )
        )
        if reviewer.scalar_one_or_none() is not None:
            return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
