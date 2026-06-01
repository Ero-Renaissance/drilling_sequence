import json
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.rbac import (
    assert_can_review,
    assert_can_sign,
    assert_can_view,
    assert_member,
)
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
from app.services.conflicts import detect_rig_conflicts
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
    """The binding approval matrix (kind="approver"); reviewers are a separate list."""
    result = await db.execute(
        select(ProjectApprover).where(
            ProjectApprover.project_id == project_id,
            ProjectApprover.kind == "approver",
        )
    )
    return list(result.scalars().all())


async def _get_required_reviewers(
    project_id: uuid.UUID, db: AsyncSession
) -> list[ProjectApprover]:
    """The technical-review matrix (kind="reviewer"); runs before approval."""
    result = await db.execute(
        select(ProjectApprover).where(
            ProjectApprover.project_id == project_id,
            ProjectApprover.kind == "reviewer",
        )
    )
    return list(result.scalars().all())


async def _fetch_signed_email_map(
    revision_id: uuid.UUID, db: AsyncSession, stage: str
) -> dict[str, Signature]:
    """Return lowercased email → Signature for one stage ("approval"/"review"),
    with users eagerly loaded."""
    result = await db.execute(
        select(Signature)
        .where(Signature.revision_id == revision_id, Signature.stage == stage)
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
    approval_sigs = await _fetch_signed_email_map(revision.id, db, "approval")
    review_sigs = await _fetch_signed_email_map(revision.id, db, "review")
    required_reviewers = await _get_required_reviewers(revision.project_id, db)
    project = await db.get(Project, revision.project_id)
    policy = project.review_policy if project else "optional"
    return {
        "id": revision.id,
        "project_id": revision.project_id,
        "rev_number": revision.rev_number,
        "label": revision.label,
        "status": revision.status,
        "stage": "review" if revision.status == "pending_review" else "approval",
        "review_required": revision.review_required,
        # Review was available (optional policy) but the planner went straight to
        # approval — surfaced so approvers can see it was bypassed.
        "review_skipped": policy == "optional" and not revision.review_required,
        "created_by_name": revision.created_by_name,
        "created_at": revision.created_at,
        # The flat list stays the *binding* (approval-stage) signatures; review
        # concurrences are surfaced via reviewer_status.
        "signatures": [s for s in revision.signatures if s.stage == "approval"],
        "approver_status": _build_approver_status(required_approvers, approval_sigs),
        "reviewer_status": _build_approver_status(required_reviewers, review_sigs),
        "decision_reason": revision.decision_reason,
        "decision_by_name": revision.decision_by_name,
        "decision_at": revision.decision_at,
    }


def _all_required_signed(
    revision: Revision,
    required: list[ProjectApprover],
    stage: str,
    signing_user_email: str | None,
) -> bool:
    """Return True when every required signer for `stage` ("approval"/"review")
    has signed (including the email being added right now, before commit).

    Two rules baked in:
    - At least one configured signer is required — an unconfigured stage never
      completes.
    - Separation of duties: the revision's creator is excluded from its own
      required set, so they can't be the one who tips it over. If that leaves the
      required set empty, the stage never auto-completes.
    """
    if not required:
        return False

    signed_emails = {
        sig.user.email.lower()
        for sig in revision.signatures
        if sig.user and sig.user.email and sig.stage == stage
    }
    if signing_user_email:
        signed_emails.add(signing_user_email.lower())

    required_emails = {a.email.lower() for a in required}
    creator_email = (
        revision.creator.email.lower()
        if revision.creator and revision.creator.email
        else None
    )
    if creator_email:
        required_emails.discard(creator_email)
    if not required_emails:
        return False  # the only signer was the submitter — can't self-sign

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
    # Refuse if there's already an open revision (in review or awaiting approval).
    pending = await db.execute(
        select(Revision).where(
            Revision.project_id == project_id,
            Revision.status.in_(["pending_review", "pending_approval"]),
        )
    )
    if pending.scalar_one_or_none():
        raise HTTPException(
            status_code=409,
            detail="A revision is already open. Resolve or discard it first.",
        )

    act_result = await db.execute(
        select(Activity)
        .where(Activity.project_id == project_id)
        .order_by(Activity.start_date)
    )
    activities = list(act_result.scalars().all())
    if not activities:
        raise HTTPException(status_code=400, detail="No activities to snapshot")

    # Hard-block: a rig can't run two activities at once, so a plan with an
    # unresolved rig conflict is physically impossible and must not reach approval.
    conflicts = detect_rig_conflicts(activities)
    if conflicts:
        c = conflicts[0]
        more = f" (and {len(conflicts) - 1} more)" if len(conflicts) > 1 else ""
        raise HTTPException(
            status_code=409,
            detail=(
                f"Rig scheduling conflict: {c['rig']} is double-booked — "
                f"\"{c['a']}\" overlaps \"{c['b']}\" by {c['overlap_days']} day(s){more}. "
                f"Resolve the overlap before submitting for approval."
            ),
        )

    # Separation of duties: if approvers are configured, at least one must be
    # someone other than the submitter — otherwise the revision could never be
    # approved (you can't approve your own plan). Zero configured approvers stays
    # allowed (the revision simply waits, pending, until approvers are added).
    approvers = await _get_required_approvers(project_id, db)
    if approvers and all(
        a.email.lower() == (current_user.email or "").lower() for a in approvers
    ):
        raise HTTPException(
            status_code=409,
            detail=(
                "You can't be the only approver of a revision you submit — "
                "add another approver before submitting."
            ),
        )

    # Resolve the route against the project's review policy. "required" forces
    # review, "off" forbids it, "optional" honours the planner's request_review.
    project = await db.get(Project, project_id)
    policy = project.review_policy if project else "optional"
    project_name = project.name if project else "a project"
    if policy == "required":
        review_required = True
    elif policy == "off":
        review_required = False
    else:  # optional
        review_required = bool(payload.request_review)

    # A review route needs at least one eligible reviewer (excluding the submitter,
    # who can't review their own plan) — otherwise review could never complete.
    reviewers: list[ProjectApprover] = []
    if review_required:
        reviewers = await _get_required_reviewers(project_id, db)
        eligible = [
            r for r in reviewers
            if r.email.lower() != (current_user.email or "").lower()
        ]
        if not eligible:
            raise HTTPException(
                status_code=409,
                detail=(
                    "Review is required but there's no eligible reviewer — add a "
                    "reviewer (other than yourself) before submitting."
                ),
            )

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
        status="pending_review" if review_required else "pending_approval",
        review_required=review_required,
        created_by=current_user.id,
        created_at=datetime.now(timezone.utc),
    )
    db.add(revision)
    await db.flush()

    for a in activities:
        a.locked_by_revision_id = revision.id

    if review_required:
        submit_detail = f"Submitted {revision.label} for review"
    else:
        submit_detail = f"Submitted {revision.label} for approval"
        if policy == "optional":
            submit_detail += " (review skipped)"
    db.add(
        governance_event(
            project_id=project_id,
            user_id=current_user.id,
            entity_type=ENTITY_REVISION,
            entity_id=revision.id,
            action="submitted_for_review" if review_required else "submitted_for_approval",
            detail=submit_detail,
        )
    )

    await db.commit()
    await db.refresh(revision)

    required_approvers = await _get_required_approvers(project_id, db)

    # Notify the people whose action is needed next (fire-and-forget): reviewers
    # when routed through review, otherwise approvers.
    recipients = (
        [r.email for r in reviewers] if review_required
        else [a.email for a in required_approvers]
    )
    if recipients:
        background_tasks.add_task(
            notify_revision_pending,
            recipients=recipients,
            project_name=project_name,
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
    # Separation of duties: the submitter can't approve their own plan.
    if revision.created_by == current_user.id:
        raise HTTPException(
            status_code=403, detail="You can't approve a revision you submitted"
        )

    for existing in revision.signatures:
        if existing.user_id == current_user.id and existing.stage == "approval":
            raise HTTPException(
                status_code=409, detail="You have already signed this revision"
            )

    sig = Signature(
        revision_id=revision.id,
        user_id=current_user.id,
        role_label=payload.role_label,
        stage="approval",
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
    if revision.status == "pending_approval" and _all_required_signed(
        revision, required_approvers, "approval", current_user.email
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


@router.put("/{revision_id}/sign-review", response_model=RevisionResponse)
async def sign_review(
    project_id: uuid.UUID,
    revision_id: uuid.UUID,
    payload: SignRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> RevisionResponse:
    """A designated reviewer signs the technical-review stage. When every required
    reviewer has signed, the revision advances to pending_approval."""
    await assert_can_review(project_id, current_user, db)
    revision = await db.get(Revision, revision_id)
    if not revision or revision.project_id != project_id:
        raise HTTPException(status_code=404, detail="Revision not found")
    if revision.status != "pending_review":
        raise HTTPException(
            status_code=400, detail="Only a revision in review can be signed off"
        )
    # Separation of duties: the submitter can't review their own plan.
    if revision.created_by == current_user.id:
        raise HTTPException(
            status_code=403, detail="You can't review a revision you submitted"
        )

    for existing in revision.signatures:
        if existing.user_id == current_user.id and existing.stage == "review":
            raise HTTPException(
                status_code=409, detail="You have already reviewed this revision"
            )

    db.add(
        Signature(
            revision_id=revision.id,
            user_id=current_user.id,
            role_label=payload.role_label,
            stage="review",
            signed_at=datetime.now(timezone.utc),
        )
    )
    db.add(
        governance_event(
            project_id=project_id,
            user_id=current_user.id,
            entity_type=ENTITY_REVISION,
            entity_id=revision.id,
            action="review_signed",
            detail=f"Reviewed Rev. {revision.rev_number:02d} as {payload.role_label}",
        )
    )

    required_reviewers = await _get_required_reviewers(project_id, db)
    advanced = _all_required_signed(
        revision, required_reviewers, "review", current_user.email
    )
    if advanced:
        revision.status = "pending_approval"
        db.add(
            governance_event(
                project_id=project_id,
                user_id=current_user.id,
                entity_type=ENTITY_REVISION,
                entity_id=revision.id,
                action="review_completed",
                detail=f"Rev. {revision.rev_number:02d} passed review — sent for approval",
            )
        )

    await db.commit()
    await db.refresh(revision)

    # Once review completes, nudge the approvers (fire-and-forget).
    if advanced:
        approvers = await _get_required_approvers(project_id, db)
        recipients = [a.email for a in approvers]
        if recipients:
            project = await db.get(Project, project_id)
            background_tasks.add_task(
                notify_revision_pending,
                recipients=recipients,
                project_name=project.name if project else "a project",
                rev_label=revision.label or f"Rev. {revision.rev_number:02d}",
                project_id=project_id,
            )

    required_approvers = await _get_required_approvers(project_id, db)
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
    # Separation of duties: the submitter can't decide on their own plan (they
    # can discard it instead).
    if revision.created_by == current_user.id:
        raise HTTPException(
            status_code=403, detail="You can't decide on a revision you submitted"
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


@router.post("/{revision_id}/review-changes", response_model=RevisionResponse)
async def review_request_changes(
    project_id: uuid.UUID,
    revision_id: uuid.UUID,
    payload: DecisionRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> RevisionResponse:
    """A reviewer bounces a revision back during the technical-review stage. Like
    request-changes, but gated to reviewers and only valid while `pending_review`.
    Reviewers can't terminally reject — that stays with approvers."""
    await assert_can_review(project_id, current_user, db)
    revision = await db.get(Revision, revision_id)
    if not revision or revision.project_id != project_id:
        raise HTTPException(status_code=404, detail="Revision not found")
    if revision.status != "pending_review":
        raise HTTPException(
            status_code=400, detail="Only a revision in review can be sent back"
        )
    # Separation of duties: the submitter can't review their own plan.
    if revision.created_by == current_user.id:
        raise HTTPException(
            status_code=403, detail="You can't review a revision you submitted"
        )

    revision.status = "changes_requested"
    revision.decision_reason = payload.reason
    revision.decision_by = current_user.id
    revision.decision_at = datetime.now(timezone.utc)
    await _unlock_activities(revision, db)
    db.add(
        governance_event(
            project_id=project_id,
            user_id=current_user.id,
            entity_type=ENTITY_REVISION,
            entity_id=revision.id,
            action="review_changes_requested",
            detail=f"Rev. {revision.rev_number:02d} sent back in review: {payload.reason}",
        )
    )
    await db.commit()
    await db.refresh(revision)

    planner_email = revision.creator.email if revision.creator else None
    if planner_email and planner_email.lower() != (current_user.email or "").lower():
        project = await db.get(Project, project_id)
        background_tasks.add_task(
            notify_revision_decision,
            recipient=planner_email,
            project_name=project.name if project else "a project",
            rev_label=revision.label or f"Rev. {revision.rev_number:02d}",
            outcome="sent back for changes in review",
            reason=payload.reason,
            decided_by=current_user.name,
            project_id=project_id,
        )

    required_approvers = await _get_required_approvers(project_id, db)
    return RevisionResponse.model_validate(
        await _to_response(revision, required_approvers, db)
    )
