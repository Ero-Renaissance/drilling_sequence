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
from app.services.audit import ENTITY_APPROVER, governance_event

router = APIRouter(
    prefix="/api/projects/{project_id}/approvers",
    tags=["approvers"],
)


@router.get("", response_model=list[ApproverResponse])
async def list_approvers(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[ProjectApprover]:
    await assert_member(project_id, current_user, db)
    result = await db.execute(
        select(ProjectApprover)
        .where(ProjectApprover.project_id == project_id)
        .order_by(ProjectApprover.email)
    )
    return list(result.scalars().all())


@router.post("", response_model=ApproverResponse, status_code=201)
async def add_approver(
    project_id: uuid.UUID,
    payload: ApproverCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ProjectApprover:
    await assert_member(project_id, current_user, db, allowed_roles={ProjectRole.planner})
    # Check for duplicate email in this project
    existing = await db.execute(
        select(ProjectApprover).where(
            ProjectApprover.project_id == project_id,
            ProjectApprover.email == payload.email.lower(),
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Approver with this email already exists")

    approver = ProjectApprover(
        project_id=project_id,
        email=payload.email.lower(),
        name=payload.name,
        role_label=payload.role_label,
    )
    db.add(approver)
    await db.flush()
    db.add(
        governance_event(
            project_id=project_id,
            user_id=current_user.id,
            entity_type=ENTITY_APPROVER,
            entity_id=approver.id,
            action="added",
            detail=f"Added approver {approver.email} ({approver.role_label})",
        )
    )
    await db.commit()
    await db.refresh(approver)
    return approver


@router.delete("/{approver_id}", status_code=204)
async def remove_approver(
    project_id: uuid.UUID,
    approver_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    await assert_member(project_id, current_user, db, allowed_roles={ProjectRole.planner})
    approver = await db.get(ProjectApprover, approver_id)
    if not approver or approver.project_id != project_id:
        raise HTTPException(status_code=404, detail="Approver not found")
    db.add(
        governance_event(
            project_id=project_id,
            user_id=current_user.id,
            entity_type=ENTITY_APPROVER,
            entity_id=approver.id,
            action="removed",
            detail=f"Removed approver {approver.email}",
        )
    )
    await db.delete(approver)
    await db.commit()
