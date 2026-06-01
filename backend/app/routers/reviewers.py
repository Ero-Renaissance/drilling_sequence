"""Designated reviewers — the review-stage signer matrix.

Mirrors `approvers.py` exactly, but on `ProjectApprover.kind="reviewer"`. Review
is a separate required-signature list that runs before approval; see
docs/review-approval-workflow-spec.md.
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.rbac import assert_member
from app.database import get_db
from app.models.approver import ProjectApprover
from app.models.project import ProjectRole
from app.models.user import User
from app.schemas.approver import ApproverCreate, ApproverResponse
from app.services.audit import ENTITY_REVIEWER, governance_event

router = APIRouter(
    prefix="/api/projects/{project_id}/reviewers",
    tags=["reviewers"],
)


@router.get("", response_model=list[ApproverResponse])
async def list_reviewers(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[ProjectApprover]:
    await assert_member(project_id, current_user, db)
    result = await db.execute(
        select(ProjectApprover)
        .where(
            ProjectApprover.project_id == project_id,
            ProjectApprover.kind == "reviewer",
        )
        .order_by(ProjectApprover.email)
    )
    return list(result.scalars().all())


@router.post("", response_model=ApproverResponse, status_code=201)
async def add_reviewer(
    project_id: uuid.UUID,
    payload: ApproverCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ProjectApprover:
    await assert_member(project_id, current_user, db, allowed_roles={ProjectRole.planner})
    # Duplicate check is scoped to the reviewer kind (the same email may also be
    # an approver — they're independent lists).
    existing = await db.execute(
        select(ProjectApprover).where(
            ProjectApprover.project_id == project_id,
            ProjectApprover.email == payload.email.lower(),
            ProjectApprover.kind == "reviewer",
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Reviewer with this email already exists")

    reviewer = ProjectApprover(
        project_id=project_id,
        email=payload.email.lower(),
        name=payload.name,
        role_label=payload.role_label,
        kind="reviewer",
    )
    db.add(reviewer)
    await db.flush()
    db.add(
        governance_event(
            project_id=project_id,
            user_id=current_user.id,
            entity_type=ENTITY_REVIEWER,
            entity_id=reviewer.id,
            action="added",
            detail=f"Added reviewer {reviewer.email} ({reviewer.role_label})",
        )
    )
    await db.commit()
    await db.refresh(reviewer)
    return reviewer


@router.delete("/{reviewer_id}", status_code=204)
async def remove_reviewer(
    project_id: uuid.UUID,
    reviewer_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    await assert_member(project_id, current_user, db, allowed_roles={ProjectRole.planner})
    reviewer = await db.get(ProjectApprover, reviewer_id)
    if not reviewer or reviewer.project_id != project_id or reviewer.kind != "reviewer":
        raise HTTPException(status_code=404, detail="Reviewer not found")
    db.add(
        governance_event(
            project_id=project_id,
            user_id=current_user.id,
            entity_type=ENTITY_REVIEWER,
            entity_id=reviewer.id,
            action="removed",
            detail=f"Removed reviewer {reviewer.email}",
        )
    )
    await db.delete(reviewer)
    await db.commit()
