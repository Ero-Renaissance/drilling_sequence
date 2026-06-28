import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.auth import get_current_user
from app.core.rbac import assert_can_view, assert_member
from app.database import get_db
from app.models.activity import Activity
from app.models.approver import ProjectApprover
from app.models.audit import AuditLog
from app.models.hwu_contract import HwuContract
from app.models.project import Project, ProjectMember, ProjectRole, ProjectStatus
from app.models.readiness import ReadinessCheck
from app.models.revision import Revision
from app.models.rig_contract import RigContract
from app.models.user import User
from app.schemas.audit import AuditEntryResponse
from app.schemas.project import (
    ProjectClone,
    ProjectCreate,
    ProjectLock,
    ProjectResponse,
    ProjectUpdate,
)
from app.services.audit import ENTITY_PROJECT, governance_event

router = APIRouter(prefix="/api/projects", tags=["projects"])

CurrentUser = Annotated[User, Depends(get_current_user)]
DB = Annotated[AsyncSession, Depends(get_db)]


async def _load_project_or_404(project_id: uuid.UUID, db: AsyncSession) -> Project:
    """Eager-load a project by id, or 404. Authorization is the caller's job."""
    result = await db.execute(
        select(Project)
        .where(Project.id == project_id)
        .options(selectinload(Project.members).selectinload(ProjectMember.user))
    )
    project = result.scalar_one_or_none()
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


async def _get_project_for_user(
    project_id: uuid.UUID,
    user: User,
    db: AsyncSession,
    allowed_roles: set[ProjectRole] | None = None,
) -> Project:
    """Load a project the user is authorized to **act on** (write/membership).

    Existence is checked first (404 if missing), then authorization is delegated
    to the shared `assert_member` helper (403 for a non-member or insufficient
    role). This keeps a single source of truth for the membership/role check while
    still returning the eager-loaded project for the response.
    """
    project = await _load_project_or_404(project_id, db)
    await assert_member(project_id, user, db, allowed_roles=allowed_roles)
    return project


async def _get_project_for_viewer(
    project_id: uuid.UUID, user: User, db: AsyncSession
) -> Project:
    """Load a project for **read** access. Broader than membership on purpose: a
    designated reviewer/approver is matched by email and may not be a ProjectMember,
    yet must be able to open the project they're asked to review/approve. Allowed:
    a global admin, a designated signer (by email), or any project member. See
    `assert_can_view`."""
    project = await _load_project_or_404(project_id, db)
    await assert_can_view(project_id, user, db)
    return project


@router.get("", response_model=list[ProjectResponse])
async def list_projects(current_user: CurrentUser, db: DB) -> list[ProjectResponse]:
    """List all projects the current user is a member of."""
    result = await db.execute(
        select(Project)
        .join(ProjectMember, ProjectMember.project_id == Project.id)
        .where(ProjectMember.user_id == current_user.id)
        .where(Project.status == ProjectStatus.active)
        .options(selectinload(Project.members).selectinload(ProjectMember.user))
        .order_by(Project.created_at.desc())
    )
    projects = result.scalars().all()
    return [ProjectResponse.from_project(p) for p in projects]


@router.post("", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
async def create_project(
    payload: ProjectCreate, current_user: CurrentUser, db: DB
) -> ProjectResponse:
    """Create a new project. The creator is automatically added as Planner."""
    project = Project(
        name=payload.name,
        field=payload.field,
        region=payload.region,
        created_by=current_user.id,
    )
    db.add(project)
    await db.flush()  # get project.id before adding the member

    member = ProjectMember(
        project_id=project.id,
        user_id=current_user.id,
        role=ProjectRole.planner,
    )
    db.add(member)
    db.add(
        governance_event(
            project_id=project.id,
            user_id=current_user.id,
            entity_type=ENTITY_PROJECT,
            entity_id=project.id,
            action="created",
            detail=f"Created project '{project.name}'",
        )
    )
    await db.commit()

    result = await db.execute(
        select(Project)
        .where(Project.id == project.id)
        .options(selectinload(Project.members).selectinload(ProjectMember.user))
    )
    project = result.scalar_one()
    return ProjectResponse.from_project(project)


@router.post(
    "/{project_id}/clone",
    response_model=ProjectResponse,
    status_code=status.HTTP_201_CREATED,
)
async def clone_project(
    project_id: uuid.UUID,
    payload: ProjectClone,
    current_user: CurrentUser,
    db: DB,
) -> ProjectResponse:
    """Create a new project from an existing one — copies activities, their
    readiness checks, and the required-approver list. Revision/signature history
    is NOT copied; the clone starts a fresh approval cycle. Activity dates are
    kept as-is. The current user becomes the Planner of the clone. Restricted to a
    Planner on the source project."""
    source = await _get_project_for_user(
        project_id, current_user, db, allowed_roles={ProjectRole.planner}
    )

    clone = Project(
        name=payload.name,
        field=payload.field if payload.field is not None else source.field,
        region=payload.region if payload.region is not None else source.region,
        created_by=current_user.id,
        cloned_from_project_id=source.id,
        # Carry the governance policy forward to the new quarter.
        review_policy=source.review_policy,
    )
    db.add(clone)
    await db.flush()  # get clone.id

    db.add(
        ProjectMember(
            project_id=clone.id,
            user_id=current_user.id,
            role=ProjectRole.planner,
        )
    )

    # Copy activities, tracking old→new id so readiness checks can be re-linked.
    source_activities = (
        await db.execute(select(Activity).where(Activity.project_id == project_id))
    ).scalars().all()

    new_activity_by_source: dict[uuid.UUID, Activity] = {}
    for src in source_activities:
        # Completed activities are finished work — they don't carry into the
        # next quarter's schedule.
        if src.completed_at is not None:
            continue
        new_activity = Activity(
            project_id=clone.id,
            # Carry the source's lineage so this activity can be matched back to
            # its origin across quarters. Falls back to the source's own id when
            # the source predates lineage tracking.
            lineage_id=src.lineage_id or src.id,
            activity_type=src.activity_type,
            start_date=src.start_date,
            end_date=src.end_date,
            well_name=src.well_name,
            rig_name=src.rig_name,
            hwu_name=src.hwu_name,
            project_group=src.project_group,
            location=src.location,
            risk=src.risk,
            comment=src.comment,
            plan_type=src.plan_type,
            updated_by=current_user.id,
        )
        db.add(new_activity)
        new_activity_by_source[src.id] = new_activity

    await db.flush()  # assign ids to the new activities

    # Copy per-activity readiness checks onto the cloned activities.
    if source_activities:
        source_checks = (
            await db.execute(
                select(ReadinessCheck).where(
                    ReadinessCheck.activity_id.in_(new_activity_by_source.keys())
                )
            )
        ).scalars().all()
        for check in source_checks:
            target = new_activity_by_source.get(check.activity_id)
            if target is None:
                continue
            db.add(
                ReadinessCheck(
                    activity_id=target.id,
                    check_code=check.check_code,
                    status=check.status,
                    notes=check.notes,
                )
            )

    # Carry the rig contracts over so the new quarter starts from the same contract
    # state — otherwise the clone has no contracts, the expiry markers read as unset,
    # and cross-quarter comparison reports every rig as "removed".
    source_contracts = (
        await db.execute(
            select(RigContract).where(RigContract.project_id == project_id)
        )
    ).scalars().all()
    for contract in source_contracts:
        db.add(
            RigContract(
                project_id=clone.id,
                rig_name=contract.rig_name,
                status=contract.status,
                contract_start=contract.contract_start,
                contract_end=contract.contract_end,
                notes=contract.notes,
                updated_by=current_user.id,
            )
        )

    # Same for HWU contracts.
    source_hwu_contracts = (
        await db.execute(
            select(HwuContract).where(HwuContract.project_id == project_id)
        )
    ).scalars().all()
    for contract in source_hwu_contracts:
        db.add(
            HwuContract(
                project_id=clone.id,
                hwu_name=contract.hwu_name,
                status=contract.status,
                contract_start=contract.contract_start,
                contract_end=contract.contract_end,
                notes=contract.notes,
                updated_by=current_user.id,
            )
        )

    # Copy the required-signer list (both reviewer and approver kinds).
    source_approvers = (
        await db.execute(
            select(ProjectApprover).where(ProjectApprover.project_id == project_id)
        )
    ).scalars().all()
    for approver in source_approvers:
        db.add(
            ProjectApprover(
                project_id=clone.id,
                email=approver.email,
                name=approver.name,
                role_label=approver.role_label,
                kind=approver.kind,
            )
        )

    db.add(
        governance_event(
            project_id=clone.id,
            user_id=current_user.id,
            entity_type=ENTITY_PROJECT,
            entity_id=clone.id,
            action="cloned",
            detail=f"Cloned from '{source.name}'",
            old_value=str(source.id),
        )
    )

    await db.commit()

    result = await db.execute(
        select(Project)
        .where(Project.id == clone.id)
        .options(selectinload(Project.members).selectinload(ProjectMember.user))
    )
    clone = result.scalar_one()
    return ProjectResponse.from_project(clone)


async def compute_project_lock(project_id: uuid.UUID, db: AsyncSession) -> ProjectLock:
    """The campaign's plan-lock summary: frozen iff some activity carries a revision
    lock. The reason is the locking revision's status — `approved` (frozen until
    Revise Plan) or otherwise `pending` (a revision is in review/approval)."""
    locked_rev_id = (
        await db.execute(
            select(Activity.locked_by_revision_id)
            .where(
                Activity.project_id == project_id,
                Activity.locked_by_revision_id.is_not(None),
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    if locked_rev_id is None:
        return ProjectLock(locked=False)
    revision = (
        await db.execute(select(Revision).where(Revision.id == locked_rev_id))
    ).scalar_one_or_none()
    reason = "approved" if revision and revision.status == "approved" else "pending"
    return ProjectLock(
        locked=True,
        reason=reason,
        revision_id=locked_rev_id,
        rev_number=revision.rev_number if revision else None,
        rev_label=revision.label if revision else None,
    )


@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(
    project_id: uuid.UUID, current_user: CurrentUser, db: DB
) -> ProjectResponse:
    # Read access — admits designated reviewers/approvers who aren't members, so
    # they can open the project they're asked to review/approve.
    project = await _get_project_for_viewer(project_id, current_user, db)
    response = ProjectResponse.from_project(project)
    response.lock = await compute_project_lock(project_id, db)
    return response


@router.get("/{project_id}/audit", response_model=list[AuditEntryResponse])
async def get_project_audit(
    project_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
    limit: int = Query(default=100, le=500),
) -> list[AuditEntryResponse]:
    """Return the project's audit trail (activity edits + governance events),
    newest first. Visible to any project member."""
    await _get_project_for_user(project_id, current_user, db)
    result = await db.execute(
        select(AuditLog)
        .where(AuditLog.project_id == project_id)
        .order_by(AuditLog.timestamp.desc())
        .limit(limit)
        .options(selectinload(AuditLog.user))
    )
    return [AuditEntryResponse.model_validate(e) for e in result.scalars().all()]


@router.patch("/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: uuid.UUID,
    payload: ProjectUpdate,
    current_user: CurrentUser,
    db: DB,
) -> ProjectResponse:
    """Update project metadata. Restricted to Planner role."""
    project = await _get_project_for_user(
        project_id, current_user, db, allowed_roles={ProjectRole.planner}
    )

    if payload.name is not None:
        project.name = payload.name
    if payload.field is not None:
        project.field = payload.field
    if payload.region is not None:
        project.region = payload.region
    if payload.status is not None:
        project.status = payload.status
    if payload.review_policy is not None and payload.review_policy.value != project.review_policy:
        # Governance setting — record the change in the audit trail.
        old_policy = project.review_policy
        project.review_policy = payload.review_policy.value
        db.add(
            governance_event(
                project_id=project_id,
                user_id=current_user.id,
                entity_type=ENTITY_PROJECT,
                entity_id=project_id,
                action="review_policy_changed",
                detail=f"Review policy set to {project.review_policy}",
                old_value=old_policy,
            )
        )

    await db.commit()
    await db.refresh(project)
    return ProjectResponse.from_project(project)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def archive_project(
    project_id: uuid.UUID, current_user: CurrentUser, db: DB
) -> None:
    """Archive a project (soft delete). Restricted to Planner role."""
    project = await _get_project_for_user(
        project_id, current_user, db, allowed_roles={ProjectRole.planner}
    )
    project.status = ProjectStatus.archived
    await db.commit()
