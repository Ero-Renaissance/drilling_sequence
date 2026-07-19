import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.auth import get_current_user
from app.core.locks import assert_project_not_locked
from app.core.rbac import assert_can_plan, assert_member
from app.database import get_db
from app.models.activity import Activity
from app.models.approver import ProjectApprover
from app.models.audit import AuditLog
from app.models.hwu_contract import HwuContract
from app.models.project import Project, ProjectMember, ProjectRole, ProjectStatus
from app.models.readiness import ProjectReadiness
from app.models.resource_registry import ResourceRecord
from app.models.revision import Revision, Signature
from app.models.rig_contract import RigContract
from app.models.user import User
from app.schemas.audit import AuditEntryResponse
from app.schemas.project import (
    KeyNotes,
    KeyNotesUpsert,
    PlannerAdd,
    ProjectApprovalSummary,
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


@router.get("", response_model=list[ProjectResponse])
async def list_projects(current_user: CurrentUser, db: DB) -> list[ProjectResponse]:
    """List all active campaigns. Visibility is org-wide by design: every
    authenticated user can see every campaign (read-only); only the campaign's
    planners — and global admins — can change anything."""
    result = await db.execute(
        select(Project)
        .where(Project.status == ProjectStatus.active)
        .options(selectinload(Project.members).selectinload(ProjectMember.user))
        .order_by(Project.created_at.desc())
    )
    projects = result.scalars().all()

    # One batched pass for the card chips + clone lineage — never per-campaign.
    summaries = await compute_approval_summaries([p.id for p in projects], db)
    source_ids = {p.cloned_from_project_id for p in projects if p.cloned_from_project_id}
    source_names: dict[uuid.UUID, str] = {}
    if source_ids:
        source_names = dict(
            (
                await db.execute(
                    select(Project.id, Project.name).where(Project.id.in_(source_ids))
                )
            ).all()
        )

    responses = []
    for p in projects:
        resp = ProjectResponse.from_project(p)
        resp.approval = summaries.get(p.id)
        if p.cloned_from_project_id:
            resp.cloned_from_name = source_names.get(p.cloned_from_project_id)
        responses.append(resp)
    return responses


@router.post("", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
async def create_project(
    payload: ProjectCreate, current_user: CurrentUser, db: DB
) -> ProjectResponse:
    """Create a new project. Requires the global planner grant (or admin); the
    creator is automatically added as Planner."""
    assert_can_plan(current_user)
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
    Planner on the source project (which, via assert_member, also requires the
    global planner grant); assert_can_plan additionally covers the admin path."""
    assert_can_plan(current_user)
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

    # Carry the per-FIELD-PROJECT readiness gates over. Keyed by well_project
    # (a name, not an activity id), so no id remap is needed — the clone keeps the
    # same field projects, so their gate statuses come with it.
    source_gates = (
        await db.execute(
            select(ProjectReadiness).where(ProjectReadiness.project_id == project_id)
        )
    ).scalars().all()
    for gate in source_gates:
        db.add(
            ProjectReadiness(
                project_id=clone.id,
                well_project=gate.well_project,
                check_code=gate.check_code,
                status=gate.status,
                notes=gate.notes,
                updated_by=current_user.id,
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
                # Rig identity is (terrain, name) — without this, cloning a
                # campaign with terrain-twin rigs would collapse both contracts
                # onto terrain "" and violate the unique constraint.
                terrain=contract.terrain,
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
                contract_start=contract.contract_start,
                contract_end=contract.contract_end,
                notes=contract.notes,
                updated_by=current_user.id,
            )
        )

    # Carry the resource registry (the campaign's fleet) over — it holds unit
    # identity (kind, terrain, name), capability class and the placeholder flag.
    # Without it the clone's Fleet view starts empty and terrain resolution for
    # its contracts breaks.
    source_resources = (
        await db.execute(
            select(ResourceRecord).where(ResourceRecord.project_id == project_id)
        )
    ).scalars().all()
    for resource in source_resources:
        db.add(
            ResourceRecord(
                project_id=clone.id,
                kind=resource.kind,
                terrain=resource.terrain,
                name=resource.name,
                name_key=resource.name_key,
                capability_class=resource.capability_class,
                is_placeholder=resource.is_placeholder,
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


@router.post(
    "/{project_id}/planners",
    response_model=ProjectResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_planner(
    project_id: uuid.UUID,
    payload: PlannerAdd,
    current_user: CurrentUser,
    db: DB,
) -> ProjectResponse:
    """Add a co-planner to the campaign, by email. Restricted to the campaign's
    planners (or an admin). Strict rule: the target must already hold the global
    planner grant — planning rights are curated by admins, not delegated."""
    await assert_member(project_id, current_user, db, allowed_roles={ProjectRole.planner})
    project = await _load_project_or_404(project_id, db)

    email = payload.email.strip().lower()
    target = (
        await db.execute(select(User).where(User.email == email))
    ).scalar_one_or_none()
    if target is None:
        # The target must have signed in at least once (users are created on
        # first login). Safe to disclose to a campaign planner.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No user with that email has signed in yet",
        )
    if not target.can_plan and not target.is_admin:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="That user does not hold the planner grant; an admin must grant it first",
        )

    existing = next((m for m in project.members if m.user_id == target.id), None)
    if existing is not None and existing.role == ProjectRole.planner:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="That user is already a planner on this campaign",
        )
    if existing is not None:
        existing.role = ProjectRole.planner
    else:
        db.add(
            ProjectMember(
                project_id=project_id,
                user_id=target.id,
                role=ProjectRole.planner,
            )
        )

    db.add(
        governance_event(
            project_id=project_id,
            user_id=current_user.id,
            entity_type=ENTITY_PROJECT,
            entity_id=project_id,
            action="planner_added",
            detail=f"Added {target.email} as planner",
        )
    )
    await db.commit()
    # Expire cached instances so the reload sees the new membership row even on
    # sessions configured with expire_on_commit=False.
    db.expire_all()
    return ProjectResponse.from_project(await _load_project_or_404(project_id, db))


@router.delete("/{project_id}/planners/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_planner(
    project_id: uuid.UUID,
    user_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
) -> None:
    """Remove a planner from the campaign. Restricted to the campaign's planners
    (or an admin). A campaign must always keep at least one planner."""
    await assert_member(project_id, current_user, db, allowed_roles={ProjectRole.planner})

    member = (
        await db.execute(
            select(ProjectMember).where(
                ProjectMember.project_id == project_id,
                ProjectMember.user_id == user_id,
                ProjectMember.role == ProjectRole.planner,
            )
        )
    ).scalar_one_or_none()
    if member is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="That user is not a planner on this campaign",
        )

    planner_count = len(
        (
            await db.execute(
                select(ProjectMember.id).where(
                    ProjectMember.project_id == project_id,
                    ProjectMember.role == ProjectRole.planner,
                )
            )
        ).scalars().all()
    )
    if planner_count <= 1:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A campaign must keep at least one planner",
        )

    removed_email = (await db.get(User, user_id)).email if member else ""
    await db.delete(member)
    db.add(
        governance_event(
            project_id=project_id,
            user_id=current_user.id,
            entity_type=ENTITY_PROJECT,
            entity_id=project_id,
            action="planner_removed",
            detail=f"Removed {removed_email} as planner",
        )
    )
    await db.commit()


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


async def compute_approval_summaries(
    project_ids: list[uuid.UUID], db: AsyncSession
) -> dict[uuid.UUID, ProjectApprovalSummary]:
    """Plan state for MANY campaigns at once — the Campaigns-list cards. Same
    vocabulary as compute_approval_summary but batched (a fixed number of
    grouped queries, never one per campaign) and without the per-viewer
    `your_action` (the list has no signer banner)."""
    if not project_ids:
        return {}

    # Latest revision per project (rev numbers are per-project sequential).
    latest_num = (
        select(
            Revision.project_id.label("pid"),
            func.max(Revision.rev_number).label("max_rev"),
        )
        .where(Revision.project_id.in_(project_ids))
        .group_by(Revision.project_id)
        .subquery()
    )
    latest_rows = (
        await db.execute(
            select(Revision).join(
                latest_num,
                (Revision.project_id == latest_num.c.pid)
                & (Revision.rev_number == latest_num.c.max_rev),
            )
        )
    ).scalars().all()
    latest_by_project = {r.project_id: r for r in latest_rows}

    # Approver headcount per campaign (chip shows x/y while pending).
    approver_counts = dict(
        (
            await db.execute(
                select(ProjectApprover.project_id, func.count())
                .where(
                    ProjectApprover.project_id.in_(project_ids),
                    ProjectApprover.kind == "approver",
                )
                .group_by(ProjectApprover.project_id)
            )
        ).all()
    )

    # Approval-stage signature counts, only for revisions still pending approval.
    pending_ids = [r.id for r in latest_rows if r.status == "pending_approval"]
    signed_counts: dict[uuid.UUID, int] = {}
    if pending_ids:
        signed_counts = dict(
            (
                await db.execute(
                    select(Signature.revision_id, func.count())
                    .where(
                        Signature.revision_id.in_(pending_ids),
                        Signature.stage == "approval",
                    )
                    .group_by(Signature.revision_id)
                )
            ).all()
        )

    # Lock + any-activities state, for the approved-vs-revising distinction.
    locked_projects = {
        row[0]
        for row in (
            await db.execute(
                select(Activity.project_id)
                .where(
                    Activity.project_id.in_(project_ids),
                    Activity.locked_by_revision_id.is_not(None),
                )
                .distinct()
            )
        ).all()
    }
    projects_with_activities = {
        row[0]
        for row in (
            await db.execute(
                select(Activity.project_id)
                .where(Activity.project_id.in_(project_ids))
                .distinct()
            )
        ).all()
    }

    out: dict[uuid.UUID, ProjectApprovalSummary] = {}
    for pid in project_ids:
        latest = latest_by_project.get(pid)
        if latest is None:
            out[pid] = ProjectApprovalSummary(status="draft")
            continue
        status = latest.status
        if (
            status == "approved"
            and pid not in locked_projects
            and pid in projects_with_activities
        ):
            status = "revising"
        out[pid] = ProjectApprovalSummary(
            status=status,
            rev_number=latest.rev_number,
            rev_label=latest.label,
            signed=signed_counts.get(latest.id, 0),
            approvers=approver_counts.get(pid, 0),
        )
    return out


async def compute_approval_summary(
    project_id: uuid.UUID, db: AsyncSession, viewer: User | None = None
) -> ProjectApprovalSummary:
    """Plan state for the header chip/banner: latest revision's status, plus
    approval-signature progress while pending — and, when a viewer is given,
    what THEY can do about it (drives the "awaiting your review" banner)."""
    latest = (
        await db.execute(
            select(Revision)
            .where(Revision.project_id == project_id)
            .order_by(Revision.rev_number.desc())
            .limit(1)
            .options(selectinload(Revision.signatures))
        )
    ).scalar_one_or_none()
    if latest is None:
        return ProjectApprovalSummary(status="draft")
    approvers = (
        await db.execute(
            select(func.count())
            .select_from(ProjectApprover)
            .where(
                ProjectApprover.project_id == project_id,
                ProjectApprover.kind == "approver",
            )
        )
    ).scalar_one()
    # Approval-stage signatures only — review signatures on a review-routed
    # revision must not inflate the approval count.
    signed = (
        sum(1 for sig in latest.signatures if sig.stage == "approval")
        if latest.status == "pending_approval"
        else 0
    )
    status = latest.status
    if status == "approved":
        # Approved but UNLOCKED = the planner ran Revise Plan: live edits are
        # in flight and the campaign must not still present as Approved.
        has_locked = (
            await db.execute(
                select(Activity.id)
                .where(
                    Activity.project_id == project_id,
                    Activity.locked_by_revision_id.is_not(None),
                )
                .limit(1)
            )
        ).scalar_one_or_none()
        has_activities = has_locked is not None or (
            await db.execute(
                select(Activity.id).where(Activity.project_id == project_id).limit(1)
            )
        ).scalar_one_or_none()
        # An empty plan can't carry a lock — only call it "revising" when there
        # are activities that could have stayed locked but didn't.
        if has_locked is None and has_activities is not None:
            status = "revising"
    return ProjectApprovalSummary(
        status=status,
        rev_number=latest.rev_number,
        rev_label=latest.label,
        signed=signed,
        approvers=approvers,
        your_action=await _viewer_action(project_id, latest, viewer, db),
    )


async def _viewer_action(
    project_id: uuid.UUID,
    latest: Revision,
    viewer: User | None,
    db: AsyncSession,
) -> str | None:
    """Mirror of the review/sign endpoint gates, non-raising: what the viewer
    can do about the pending revision. Display-only — the endpoints stay the
    enforcement. The revision's creator gets None (separation of duties: they
    may only discard), whatever their other hats."""
    if viewer is None:
        return None
    if latest.status not in ("pending_review", "pending_approval"):
        return None
    if latest.created_by == viewer.id:
        return None
    action = "review" if latest.status == "pending_review" else "approve"
    if viewer.is_admin:
        return action
    if not viewer.email:
        return None
    kind = "reviewer" if latest.status == "pending_review" else "approver"
    designated = (
        await db.execute(
            select(ProjectApprover).where(
                ProjectApprover.project_id == project_id,
                ProjectApprover.email == viewer.email.lower(),
                ProjectApprover.kind == kind,
            )
        )
    ).scalar_one_or_none()
    return action if designated is not None else None


@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(
    project_id: uuid.UUID, current_user: CurrentUser, db: DB
) -> ProjectResponse:
    # Reads are org-wide: any authenticated user may open any campaign.
    project = await _load_project_or_404(project_id, db)
    response = ProjectResponse.from_project(project)
    response.lock = await compute_project_lock(project_id, db)
    response.approval = await compute_approval_summary(project_id, db, current_user)
    if project.key_notes:
        editor = (
            await db.get(User, project.key_notes_updated_by)
            if project.key_notes_updated_by
            else None
        )
        response.key_notes = KeyNotes(
            body=project.key_notes,
            updated_at=project.key_notes_updated_at,
            updated_by_name=editor.name if editor else None,
        )
    return response


@router.put("/{project_id}/key-notes", response_model=KeyNotes)
async def upsert_key_notes(
    project_id: uuid.UUID,
    payload: KeyNotesUpsert,
    current_user: CurrentUser,
    db: DB,
) -> KeyNotes:
    """The planner's campaign bulletin (Overview card). Planner-only, and
    lock-gated like every plan-shaped write — while a revision is pending or
    the plan is frozen-by-approval, the communicated story holds still too.
    An empty body clears the notes. Audited as a plain activity-log entry."""
    await assert_member(project_id, current_user, db, allowed_roles={ProjectRole.planner})
    await assert_project_not_locked(project_id, db)
    project = await _load_project_or_404(project_id, db)

    body = payload.body.strip()
    project.key_notes = body or None
    project.key_notes_updated_at = datetime.now(timezone.utc)
    project.key_notes_updated_by = current_user.id
    db.add(
        AuditLog(
            project_id=project_id,
            user_id=current_user.id,
            entity_type="project",
            entity_id=project_id,
            field="key_notes_updated",
            old_value=None,
            new_value="cleared" if not body else f"{len(body)} chars",
        )
    )
    await db.commit()
    return KeyNotes(
        body=body,
        updated_at=project.key_notes_updated_at,
        updated_by_name=current_user.name,
    )


@router.get("/{project_id}/audit", response_model=list[AuditEntryResponse])
async def get_project_audit(
    project_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
    limit: int = Query(default=100, le=500),
) -> list[AuditEntryResponse]:
    """Return the project's audit trail (activity edits + governance events),
    newest first. Reads are org-wide: any authenticated user may view it."""
    await _load_project_or_404(project_id, db)
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
