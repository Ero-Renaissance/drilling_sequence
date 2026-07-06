import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.approver import ProjectApprover
from app.models.project import ProjectMember, ProjectRole
from app.models.user import User


def assert_can_plan(user: User) -> None:
    """Creating or cloning a campaign requires the global planner grant.

    The grant (`User.can_plan`) is handed out by an admin on the Admin page;
    admins implicitly hold it. Fail closed for everyone else.
    """
    if user.is_admin or user.can_plan:
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Insufficient role for this action",
    )


async def assert_member(
    project_id: uuid.UUID,
    user: User,
    db: AsyncSession,
    allowed_roles: set[ProjectRole] | None = None,
) -> None:
    """Ensure `user` may act on `project_id`.

    Global admins always pass. Otherwise the user must be a ProjectMember, and
    — when `allowed_roles` is given — hold one of those roles. Acting *as a
    planner* additionally requires the global planner grant (`User.can_plan`):
    revoking the grant strips planning rights on every campaign immediately,
    without having to clean up per-campaign planner memberships.
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
    if (
        allowed_roles is not None
        and member.role == ProjectRole.planner
        and ProjectRole.planner in allowed_roles
        and not user.can_plan
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient role for this action",
        )


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
