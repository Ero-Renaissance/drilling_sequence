"""Current-user views that span projects (the in-app notification surface)."""
import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.database import get_db
from app.models.approver import ProjectApprover
from app.models.project import Project
from app.models.revision import Revision
from app.models.user import User

router = APIRouter(prefix="/api/me", tags=["me"])


class PendingApproval(BaseModel):
    revision_id: uuid.UUID
    project_id: uuid.UUID
    project_name: str
    rev_number: int
    label: str | None
    created_at: datetime


@router.get("/pending-approvals", response_model=list[PendingApproval])
async def pending_approvals(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[PendingApproval]:
    """Revisions awaiting the current user's signature: pending revisions in
    projects where the user is a designated approver (matched by email) and has
    not yet signed. This is the same population that receives the email nudge."""
    email = (current_user.email or "").strip().lower()
    if not email:
        return []

    project_ids = (
        await db.execute(
            select(ProjectApprover.project_id).where(
                func.lower(ProjectApprover.email) == email,
                ProjectApprover.kind == "approver",
            )
        )
    ).scalars().all()
    if not project_ids:
        return []

    result = await db.execute(
        select(Revision, Project.name)
        .join(Project, Project.id == Revision.project_id)
        .where(
            Revision.project_id.in_(project_ids),
            Revision.status == "pending_approval",
            # Separation of duties: you can't approve a revision you submitted, so
            # it never belongs on your "awaiting my signature" list.
            Revision.created_by != current_user.id,
        )
        .order_by(Revision.created_at.desc())
    )

    out: list[PendingApproval] = []
    for revision, project_name in result.all():
        already_signed = any(
            s.user_id == current_user.id and s.stage == "approval"
            for s in revision.signatures
        )
        if already_signed:
            continue
        out.append(
            PendingApproval(
                revision_id=revision.id,
                project_id=revision.project_id,
                project_name=project_name,
                rev_number=revision.rev_number,
                label=revision.label,
                created_at=revision.created_at,
            )
        )
    return out
