import uuid

from fastapi import HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.project import Project
from app.models.revision import Revision

# "Pending or approved": approval keeps the plan locked (the approved snapshot is
# the record) until a planner reopens it with Revise Plan — so neither message
# may say "awaiting approval", which is wrong once the revision is approved.
_ACTIVITY_LOCKED_DETAIL = (
    "This activity is locked by a revision (pending or approved) and cannot be modified."
)
_PROJECT_LOCKED_DETAIL = (
    "This campaign's plan is locked by a revision (pending or approved). "
    "Resolve the revision, or reopen an approved plan with Revise Plan, "
    "before making this change."
)
_SIGNERS_FROZEN_DETAIL = (
    "A revision is in review or awaiting approval; the reviewer/approver lists "
    "are frozen until it is resolved, so the required signatures can't change "
    "under the people signing."
)


async def lock_campaign_writes(project_id: uuid.UUID, db: AsyncSession) -> None:
    """Serialize plan writes within one campaign (call right after the role check).

    A write that reads the plan to decide what to write — "is the plan locked?",
    "is this the version the planner loaded?", "is that project name free?",
    "which wells does this project have?" — takes this lock FIRST, so no other
    plan write in the same campaign can commit between its checks and its
    writes. It is the campaign row's write lock, held until the request's
    commit or rollback; writes in different campaigns don't wait on each other.

    A no-op UPDATE rather than SELECT ... FOR UPDATE: SQLAlchemy's SQL Server
    dialect drops FOR UPDATE, whereas an UPDATE takes an exclusive row lock on
    SQL Server and PostgreSQL alike (SQLite locks the whole database to write).
    """
    await db.execute(
        update(Project)
        .where(Project.id == project_id)
        .values(name=Project.name)
        .execution_options(synchronize_session=False)
    )


def ensure_activity_unlocked(activity: Activity) -> None:
    """Block mutations to an activity locked by a revision (pending or approved).

    The lock (`locked_by_revision_id`) is set when a revision is created and
    cleared on decline / request-changes / discard, or when a planner reopens an
    approved plan (Revise Plan) — approval keeps it. Enforcing it server-side —
    not only in the UI — keeps the plan under review from changing out from under
    the approvers who are signing it, and the approved plan from drifting from
    its snapshot. Applies to activity edits, completion and deletion.
    """
    if activity.locked_by_revision_id is not None:
        raise HTTPException(
            status_code=status.HTTP_423_LOCKED, detail=_ACTIVITY_LOCKED_DETAIL
        )


async def assert_project_not_locked(project_id: uuid.UUID, db: AsyncSession) -> None:
    """Block campaign-wide plan changes while any activity is locked by a
    revision (pending or approved).

    Used by operations that aren't tied to a single activity but still alter the
    plan under review or approved — bulk CSV import, rig/HWU contract edits (the
    contract is captured in the snapshot via its expiry) and status writes to
    readiness checks that lock with the plan (the Project gates).
    """
    result = await db.execute(
        select(Activity.id)
        .where(
            Activity.project_id == project_id,
            Activity.locked_by_revision_id.is_not(None),
        )
        .limit(1)
    )
    if result.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_423_LOCKED, detail=_PROJECT_LOCKED_DETAIL
        )


async def assert_signer_lists_not_frozen(
    project_id: uuid.UUID, db: AsyncSession
) -> None:
    """Block reviewer/approver matrix edits while a revision is OPEN
    (pending_review / pending_approval).

    The required-signature sets are recomputed from the matrices at every
    signing event, so editing them mid-flight moves the approval bar under the
    signers — and removing the last unsigned approver strands the revision
    pending forever (no signing event remains to trigger completion). Distinct
    from the plan lock: an APPROVED (frozen) plan does NOT freeze the matrices,
    since edits then only shape the next cycle.
    """
    result = await db.execute(
        select(Revision.id)
        .where(
            Revision.project_id == project_id,
            Revision.status.in_(["pending_review", "pending_approval"]),
        )
        .limit(1)
    )
    if result.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_423_LOCKED, detail=_SIGNERS_FROZEN_DETAIL
        )
