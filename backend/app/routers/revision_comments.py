"""The revision deliberation thread.

Signing carries no text and a decision reason only exists on
reject/request-changes — so before this, a reviewer or approver could not
record context ("checked the swamp lanes, waiting on LLI confirmation")
without ENDING the pending state. Comments fill that gap:

- POST is allowed only while the revision is pending (review or approval) and
  only to the people with a part in the workflow — a global admin, a
  designated reviewer/approver (the email matrices), or a project planner.
  Viewers and plain members read, they don't post.
- Reads are org-wide, like every other read in the app: the thread is part of
  the approval record and stays visible after approve / reject / discard.
- Append-only: no update or delete exists, mirroring the audit log.
"""
import uuid
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.rbac import assert_member
from app.database import get_db
from app.models.approver import ProjectApprover
from app.models.project import Project, ProjectRole
from app.models.revision import Revision, RevisionComment
from app.models.user import User
from app.schemas.revision_comment import RevisionCommentCreate, RevisionCommentResponse
from app.services.email import notify_revision_comment

router = APIRouter(
    prefix="/api/projects/{project_id}/revisions/{revision_id}/comments",
    tags=["revision-comments"],
)

CurrentUser = Annotated[User, Depends(get_current_user)]
DB = Annotated[AsyncSession, Depends(get_db)]


async def _get_revision(
    project_id: uuid.UUID, revision_id: uuid.UUID, db: AsyncSession
) -> Revision:
    revision = await db.get(Revision, revision_id)
    # BOLA guard: the revision must belong to the project in the path.
    if not revision or revision.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Revision not found")
    return revision


async def _author_role(
    project_id: uuid.UUID, user: User, db: AsyncSession
) -> str:
    """The capacity in which this user may post — or 403.

    Order matters only for the LABEL (a designated approver who is also a
    planner reads as "Approver"). Deny by default: viewers and plain members
    can read the thread but not write to it.
    """
    if user.is_admin:
        return "Admin"
    if user.email:
        kinds = set(
            (
                await db.execute(
                    select(ProjectApprover.kind).where(
                        ProjectApprover.project_id == project_id,
                        ProjectApprover.email == user.email.lower(),
                    )
                )
            ).scalars().all()
        )
        if "approver" in kinds:
            return "Approver"
        if "reviewer" in kinds:
            return "Reviewer"
    try:
        await assert_member(project_id, user, db, allowed_roles={ProjectRole.planner})
        return "Planner"
    except HTTPException:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")


@router.get("", response_model=list[RevisionCommentResponse])
async def list_comments(
    project_id: uuid.UUID,
    revision_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
) -> list[RevisionComment]:
    # Reads are org-wide: any authenticated user may view the deliberation —
    # it is part of the approval record, before and after resolution.
    await _get_revision(project_id, revision_id, db)
    result = await db.execute(
        select(RevisionComment)
        .where(RevisionComment.revision_id == revision_id)
        .order_by(RevisionComment.created_at)
    )
    return list(result.scalars().all())


@router.post("", response_model=RevisionCommentResponse, status_code=201)
async def add_comment(
    project_id: uuid.UUID,
    revision_id: uuid.UUID,
    payload: RevisionCommentCreate,
    background_tasks: BackgroundTasks,
    current_user: CurrentUser,
    db: DB,
) -> RevisionComment:
    role = await _author_role(project_id, current_user, db)
    revision = await _get_revision(project_id, revision_id, db)
    # The thread is the PENDING deliberation; after resolution the record is
    # frozen — late additions would rewrite the context decisions were made in.
    if revision.status not in ("pending_review", "pending_approval"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Comments are open only while the revision is in review or awaiting approval.",
        )

    comment = RevisionComment(
        revision_id=revision.id,
        user_id=current_user.id,
        author_role=role,
        stage="review" if revision.status == "pending_review" else "approval",
        body=payload.body,
    )
    db.add(comment)
    await db.commit()
    await db.refresh(comment)

    # Notify the thread's participants — the revision's creator plus everyone
    # who commented before, never the author themself. Fire-and-forget: email
    # must not break the request path.
    recipients: dict[str, None] = {}
    if revision.creator and revision.creator.email:
        recipients[revision.creator.email.lower()] = None
    prior = await db.execute(
        select(RevisionComment).where(RevisionComment.revision_id == revision_id)
    )
    for c in prior.scalars():
        if c.user and c.user.email:
            recipients[c.user.email.lower()] = None
    if current_user.email:
        recipients.pop(current_user.email.lower(), None)
    if recipients:
        project = await db.get(Project, project_id)
        background_tasks.add_task(
            notify_revision_comment,
            recipients=list(recipients),
            project_name=project.name if project else "a project",
            rev_label=revision.label or f"Rev. {revision.rev_number:02d}",
            author_name=current_user.name or "A colleague",
            author_role=role,
            body=payload.body,
            project_id=project_id,
            revision_id=revision_id,
        )
    return comment
