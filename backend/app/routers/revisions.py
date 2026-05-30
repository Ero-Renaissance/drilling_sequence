import json
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.rbac import assert_can_sign, assert_can_view, assert_member
from app.database import get_db
from app.models.activity import Activity
from app.models.approver import ProjectApprover
from app.models.project import Project, ProjectRole
from app.models.revision import Revision, Signature
from app.models.user import User
from app.schemas.approver import ApproverSignStatus
from app.schemas.diff import RevisionDiffResponse
from app.schemas.revision import (
    DecisionRequest,
    RevisionCreate,
    RevisionDetailResponse,
    RevisionResponse,
    SignRequest,
)
from app.services.audit import ENTITY_REVISION, governance_event
from app.services.email import notify_revision_decision, notify_revision_pending
from app.services.revision_diff import diff_snapshots
from app.services.snapshot import build_project_snapshot

router = APIRouter(
    prefix="/api/projects/{project_id}/revisions",
    tags=["revisions"],
)


async def _get_required_approvers(
    project_id: uuid.UUID, db: AsyncSession
) -> list[ProjectApprover]:
    result = await db.execute(
        select(ProjectApprover).where(ProjectApprover.project_id == project_id)
    )
    return list(result.scalars().all())


async def _fetch_signed_email_map(
    revision_id: uuid.UUID, db: AsyncSession
) -> dict[str, Signature]:
    """Return a dict mapping lowercased email → Signature, with users eagerly loaded."""
    result = await db.execute(
        select(Signature)
        .where(Signature.revision_id == revision_id)
        .options(selectinload(Signature.user))
    )
    out: dict[str, Signature] = {}
    for sig in result.scalars().all():
        if sig.user and sig.user.email:
            out[sig.user.email.lower()] = sig
    return out


def _build_approver_status(
    required_approvers: list[ProjectApprover],
    sig_by_email: dict[str, Signature],
) -> list[ApproverSignStatus]:
    """Compute per-approver sign status from a pre-fetched email→signature map."""
    if not required_approvers:
        return []

    statuses = []
    for approver in required_approvers:
        matched = sig_by_email.get(approver.email.lower())
        statuses.append(
            ApproverSignStatus(
                email=approver.email,
                name=approver.name,
                role_label=approver.role_label,
                signed=matched is not None,
                signed_at=matched.signed_at if matched else None,
                signer_name=matched.user.name if matched and matched.user else None,
            )
        )
    return statuses


async def _to_response(
    revision: Revision,
    required_approvers: list[ProjectApprover],
    db: AsyncSession,
) -> dict:
    sig_by_email = await _fetch_signed_email_map(revision.id, db)
    return {
        "id": revision.id,
        "project_id": revision.project_id,
        "rev_number": revision.rev_number,
        "label": revision.label,
        "status": revision.status,
        "created_by_name": revision.created_by_name,
        "created_at": revision.created_at,
        "signatures": revision.signatures,
        "approver_status": _build_approver_status(required_approvers, sig_by_email),
        "decision_reason": revision.decision_reason,
        "decision_by_name": revision.decision_by_name,
        "decision_at": revision.decision_at,
    }


def _all_required_have_signed(
    revision: Revision,
    required_approvers: list[ProjectApprover],
    signing_user_email: str | None,
) -> bool:
    """Return True when every required approver email appears in the signatures
    (including the email being added right now, before commit). Approval now
    requires at least one configured approver — an unconfigured revision can be
    signed but never auto-approves."""
    if not required_approvers:
        return False  # require designated approvers before a revision can approve

    signed_emails = {
        sig.user.email.lower()
        for sig in revision.signatures
        if sig.user and sig.user.email
    }
    if signing_user_email:
        signed_emails.add(signing_user_email.lower())

    required_emails = {a.email.lower() for a in required_approvers}
    return required_emails.issubset(signed_emails)


async def _unlock_activities(revision: Revision, db: AsyncSession) -> None:
    locked = await db.execute(
        select(Activity).where(Activity.locked_by_revision_id == revision.id)
    )
    for a in locked.scalars().all():
        a.locked_by_revision_id = None


# ── Endpoints ─────────────────────────────────────────────────────────────────


@router.get("", response_model=list[RevisionResponse])
async def list_revisions(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await assert_member(project_id, current_user, db)
    result = await db.execute(
        select(Revision)
        .where(Revision.project_id == project_id)
        .order_by(Revision.rev_number.desc())
    )
    revisions = list(result.scalars().all())
    required_approvers = await _get_required_approvers(project_id, db)
    return [
        RevisionResponse.model_validate(await _to_response(r, required_approvers, db))
        for r in revisions
    ]


@router.post("", response_model=RevisionResponse, status_code=201)
async def create_revision(
    project_id: uuid.UUID,
    payload: RevisionCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> RevisionResponse:
    await assert_member(project_id, current_user, db, allowed_roles={ProjectRole.planner})
    # Refuse if there's already an open (pending) revision
    pending = await db.execute(
        select(Revision).where(
            Revision.project_id == project_id,
            Revision.status == "pending_approval",
        )
    )
    if pending.scalar_one_or_none():
        raise HTTPException(
            status_code=409,
            detail="A revision is already pending approval. Approve or discard it first.",
        )

    act_result = await db.execute(
        select(Activity)
        .where(Activity.project_id == project_id)
        .order_by(Activity.start_date)
    )
    activities = list(act_result.scalars().all())
    if not activities:
        raise HTTPException(status_code=400, detail="No activities to snapshot")

    # Capture activities + readiness state at the moment the revision is created
    snapshot = await build_project_snapshot(project_id, db)

    rev_result = await db.execute(
        select(Revision.rev_number)
        .where(Revision.project_id == project_id)
        .order_by(Revision.rev_number.desc())
        .limit(1)
    )
    last_rev = rev_result.scalar_one_or_none()
    rev_number = (last_rev or 0) + 1

    revision = Revision(
        project_id=project_id,
        rev_number=rev_number,
        label=payload.label or f"Rev. {rev_number:02d}",
        snapshot_json=json.dumps(snapshot),
        status="pending_approval",
        created_by=current_user.id,
        created_at=datetime.now(timezone.utc),
    )
    db.add(revision)
    await db.flush()

    for a in activities:
        a.locked_by_revision_id = revision.id

    await db.commit()
    await db.refresh(revision)

    required_approvers = await _get_required_approvers(project_id, db)

    # Notify designated approvers their signature is needed (fire-and-forget).
    recipients = [a.email for a in required_approvers]
    if recipients:
        project = await db.get(Project, project_id)
        background_tasks.add_task(
            notify_revision_pending,
            recipients=recipients,
            project_name=project.name if project else "a project",
            rev_label=revision.label or f"Rev. {rev_number:02d}",
            project_id=project_id,
        )

    return RevisionResponse.model_validate(
        await _to_response(revision, required_approvers, db)
    )


async def _resolve_diff_side(
    project_id: uuid.UUID, ref: str, db: AsyncSession
) -> tuple[list[dict], dict]:
    """Resolve a diff ref to (snapshot, side-descriptor). `ref` is either the
    literal "live" (current working plan) or a revision UUID."""
    if ref == "live":
        return await build_project_snapshot(project_id, db), {"kind": "live"}
    try:
        rev_id = uuid.UUID(ref)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"Invalid revision reference: {ref!r}")
    revision = await db.get(Revision, rev_id)
    if not revision or revision.project_id != project_id:
        raise HTTPException(status_code=404, detail="Revision not found")
    return json.loads(revision.snapshot_json), {
        "kind": "revision",
        "revision_id": str(revision.id),
        "rev_number": revision.rev_number,
        "label": revision.label,
    }


async def _resolve_last_approved_baseline(
    project_id: uuid.UUID, cutoff: int | None, db: AsyncSession
) -> tuple[list[dict], dict, str]:
    """Resolve the most recent APPROVED baseline to diff against, plus how to match
    activities to it. Returns (snapshot, side-descriptor, match_by).

    Resolution order:
      1. the latest approved revision in this project older than `cutoff`
         (a rev_number; None means "latest overall") → match activities by id;
      2. else the latest approved revision of the project this one was cloned from
         → match by lineage (activities carry lineage across the clone);
      3. else an empty baseline — everything reads as added (first approval).
    """
    stmt = select(Revision).where(
        Revision.project_id == project_id,
        Revision.status == "approved",
    )
    if cutoff is not None:
        stmt = stmt.where(Revision.rev_number < cutoff)
    rev = (
        await db.execute(stmt.order_by(Revision.rev_number.desc()).limit(1))
    ).scalar_one_or_none()
    if rev is not None:
        return (
            json.loads(rev.snapshot_json),
            {
                "kind": "revision",
                "revision_id": str(rev.id),
                "rev_number": rev.rev_number,
                "label": rev.label,
            },
            "id",
        )

    project = await db.get(Project, project_id)
    parent_id = project.cloned_from_project_id if project else None
    if parent_id is not None:
        parent_rev = (
            await db.execute(
                select(Revision)
                .where(
                    Revision.project_id == parent_id,
                    Revision.status == "approved",
                )
                .order_by(Revision.rev_number.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        if parent_rev is not None:
            parent = await db.get(Project, parent_id)
            label = f"{parent.name} · {parent_rev.label}" if parent else parent_rev.label
            return (
                json.loads(parent_rev.snapshot_json),
                {
                    "kind": "revision",
                    "revision_id": str(parent_rev.id),
                    "rev_number": parent_rev.rev_number,
                    "label": label,
                    "project_id": str(parent_id),
                },
                "lineage",
            )

    return [], {"kind": "none"}, "id"


@router.get("/compare", response_model=RevisionDiffResponse)
async def compare_revisions(
    project_id: uuid.UUID,
    base: str,
    target: str = "live",
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> RevisionDiffResponse:
    """Diff two snapshots of a project. `base` and `target` are each a revision
    UUID or the literal "live" (the current working plan). `base` is the older
    side; `target` defaults to the live plan."""
    await assert_can_view(project_id, current_user, db)
    base_snapshot, base_side = await _resolve_diff_side(project_id, base, db)
    target_snapshot, target_side = await _resolve_diff_side(project_id, target, db)
    diff = diff_snapshots(base_snapshot, target_snapshot)
    return RevisionDiffResponse.model_validate(
        {"base": base_side, "target": target_side, **diff}
    )


@router.get("/cross-compare", response_model=RevisionDiffResponse)
async def cross_compare(
    project_id: uuid.UUID,
    base_project_id: uuid.UUID,
    base: str = "live",
    target: str = "live",
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> RevisionDiffResponse:
    """Diff this project (the `target` side, e.g. the new quarter Q2) against
    another project (`base_project_id`, e.g. Q1). Each side's ref is a revision
    UUID within that project or the literal "live". Activities are matched by
    lineage (carried across clones), so a rig reassigned to another well reads
    as a modified field rather than add+remove."""
    await assert_can_view(project_id, current_user, db)
    await assert_can_view(base_project_id, current_user, db)
    base_snapshot, base_side = await _resolve_diff_side(base_project_id, base, db)
    target_snapshot, target_side = await _resolve_diff_side(project_id, target, db)
    diff = diff_snapshots(base_snapshot, target_snapshot, match_by="lineage")
    return RevisionDiffResponse.model_validate(
        {"base": base_side, "target": target_side, **diff}
    )


@router.get("/changes-since-approved", response_model=RevisionDiffResponse)
async def changes_since_approved(
    project_id: uuid.UUID,
    target: str = "live",
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> RevisionDiffResponse:
    """Diff `target` (a revision UUID, or the literal "live") against the most
    recent approved baseline — resolved server-side so callers don't have to find
    it themselves. Powers the approver's "what changed since the last approval"
    view and the planner's "live vs last approved" pre-submit check.

    Baseline: the latest approved revision in this project older than `target`;
    failing that, the latest approved revision of the project this one was cloned
    from (matched by lineage); failing that, an empty baseline (everything added).
    """
    await assert_can_view(project_id, current_user, db)

    target_snapshot, target_side = await _resolve_diff_side(project_id, target, db)
    cutoff = target_side.get("rev_number")  # None when target == "live"
    base_snapshot, base_side, match_by = await _resolve_last_approved_baseline(
        project_id, cutoff, db
    )
    diff = diff_snapshots(base_snapshot, target_snapshot, match_by=match_by)
    return RevisionDiffResponse.model_validate(
        {"base": base_side, "target": target_side, **diff}
    )


@router.get("/{revision_id}", response_model=RevisionDetailResponse)
async def get_revision(
    project_id: uuid.UUID,
    revision_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> RevisionDetailResponse:
    await assert_member(project_id, current_user, db)
    revision = await db.get(Revision, revision_id)
    if not revision or revision.project_id != project_id:
        raise HTTPException(status_code=404, detail="Revision not found")
    required_approvers = await _get_required_approvers(project_id, db)
    base = await _to_response(revision, required_approvers, db)
    base["snapshot_json"] = revision.snapshot_json
    return RevisionDetailResponse.model_validate(base)


@router.put("/{revision_id}/sign", response_model=RevisionResponse)
async def sign_revision(
    project_id: uuid.UUID,
    revision_id: uuid.UUID,
    payload: SignRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> RevisionResponse:
    await assert_can_sign(project_id, current_user, db)
    revision = await db.get(Revision, revision_id)
    if not revision or revision.project_id != project_id:
        raise HTTPException(status_code=404, detail="Revision not found")
    if revision.status != "pending_approval":
        raise HTTPException(
            status_code=400, detail="Only a pending revision can be signed"
        )

    for existing in revision.signatures:
        if existing.user_id == current_user.id:
            raise HTTPException(
                status_code=409, detail="You have already signed this revision"
            )

    sig = Signature(
        revision_id=revision.id,
        user_id=current_user.id,
        role_label=payload.role_label,
        signed_at=datetime.now(timezone.utc),
    )
    db.add(sig)
    db.add(
        governance_event(
            project_id=project_id,
            user_id=current_user.id,
            entity_type=ENTITY_REVISION,
            entity_id=revision.id,
            action="signed",
            detail=f"Signed Rev. {revision.rev_number:02d} as {payload.role_label}",
        )
    )

    required_approvers = await _get_required_approvers(project_id, db)
    if revision.status == "pending_approval" and _all_required_have_signed(
        revision, required_approvers, current_user.email
    ):
        revision.status = "approved"
        await _unlock_activities(revision, db)
        db.add(
            governance_event(
                project_id=project_id,
                user_id=current_user.id,
                entity_type=ENTITY_REVISION,
                entity_id=revision.id,
                action="approved",
                detail=f"Rev. {revision.rev_number:02d} approved",
            )
        )

    await db.commit()
    await db.refresh(revision)

    return RevisionResponse.model_validate(
        await _to_response(revision, required_approvers, db)
    )


@router.delete("/{revision_id}", status_code=204)
async def discard_revision(
    project_id: uuid.UUID,
    revision_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    await assert_member(project_id, current_user, db, allowed_roles={ProjectRole.planner})
    revision = await db.get(Revision, revision_id)
    if not revision or revision.project_id != project_id:
        raise HTTPException(status_code=404, detail="Revision not found")
    if revision.status == "approved":
        raise HTTPException(status_code=400, detail="Cannot discard an approved revision")

    revision.status = "discarded"
    await _unlock_activities(revision, db)
    db.add(
        governance_event(
            project_id=project_id,
            user_id=current_user.id,
            entity_type=ENTITY_REVISION,
            entity_id=revision.id,
            action="discarded",
            detail=f"Rev. {revision.rev_number:02d} discarded",
        )
    )
    await db.commit()


async def _record_decision(
    project_id: uuid.UUID,
    revision_id: uuid.UUID,
    reason: str,
    *,
    new_status: str,
    action: str,
    detail_verb: str,
    current_user: User,
    db: AsyncSession,
    background_tasks: BackgroundTasks,
) -> RevisionResponse:
    """Shared body for reject / request-changes: a non-final approver decision
    that closes the revision with a reason and unlocks its activities."""
    await assert_can_sign(project_id, current_user, db)
    revision = await db.get(Revision, revision_id)
    if not revision or revision.project_id != project_id:
        raise HTTPException(status_code=404, detail="Revision not found")
    if revision.status != "pending_approval":
        raise HTTPException(
            status_code=400, detail="Only a pending revision can be actioned"
        )

    revision.status = new_status
    revision.decision_reason = reason
    revision.decision_by = current_user.id
    revision.decision_at = datetime.now(timezone.utc)
    await _unlock_activities(revision, db)
    db.add(
        governance_event(
            project_id=project_id,
            user_id=current_user.id,
            entity_type=ENTITY_REVISION,
            entity_id=revision.id,
            action=action,
            detail=f"Rev. {revision.rev_number:02d} {detail_verb}: {reason}",
        )
    )
    await db.commit()
    await db.refresh(revision)

    # Notify the planner who created the revision (fire-and-forget). Skip when the
    # decider is also the creator — no point emailing yourself.
    planner_email = revision.creator.email if revision.creator else None
    if planner_email and planner_email.lower() != (current_user.email or "").lower():
        project = await db.get(Project, project_id)
        background_tasks.add_task(
            notify_revision_decision,
            recipient=planner_email,
            project_name=project.name if project else "a project",
            rev_label=revision.label or f"Rev. {revision.rev_number:02d}",
            outcome=detail_verb,
            reason=reason,
            decided_by=current_user.name,
            project_id=project_id,
        )

    required_approvers = await _get_required_approvers(project_id, db)
    return RevisionResponse.model_validate(
        await _to_response(revision, required_approvers, db)
    )


@router.post("/{revision_id}/reject", response_model=RevisionResponse)
async def reject_revision(
    project_id: uuid.UUID,
    revision_id: uuid.UUID,
    payload: DecisionRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> RevisionResponse:
    return await _record_decision(
        project_id,
        revision_id,
        payload.reason,
        new_status="rejected",
        action="rejected",
        detail_verb="rejected",
        current_user=current_user,
        db=db,
        background_tasks=background_tasks,
    )


@router.post("/{revision_id}/request-changes", response_model=RevisionResponse)
async def request_changes(
    project_id: uuid.UUID,
    revision_id: uuid.UUID,
    payload: DecisionRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> RevisionResponse:
    return await _record_decision(
        project_id,
        revision_id,
        payload.reason,
        new_status="changes_requested",
        action="changes_requested",
        detail_verb="sent back for changes",
        current_user=current_user,
        db=db,
        background_tasks=background_tasks,
    )
