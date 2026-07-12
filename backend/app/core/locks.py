import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.revision import Revision

_ACTIVITY_LOCKED_DETAIL = (
    "This activity is part of a revision awaiting approval and cannot be modified."
)
_PROJECT_LOCKED_DETAIL = (
    "This project has a revision awaiting approval; its plan is locked. "
    "Resolve the revision before making this change."
)
_SIGNERS_FROZEN_DETAIL = (
    "A revision is in review or awaiting approval; the reviewer/approver lists "
    "are frozen until it is resolved, so the required signatures can't change "
    "under the people signing."
)


def ensure_activity_unlocked(activity: Activity) -> None:
    """Block mutations to an activity frozen by a revision awaiting approval.

    The lock (`locked_by_revision_id`) is set when a revision is created and
    cleared on approve / decline / discard. Enforcing it server-side — not only in
    the UI — keeps the plan under review from changing out from under the
    approvers who are signing it. Applies to activity edits, completion, deletion,
    and readiness-check updates.
    """
    if activity.locked_by_revision_id is not None:
        raise HTTPException(
            status_code=status.HTTP_423_LOCKED, detail=_ACTIVITY_LOCKED_DETAIL
        )


async def assert_project_not_locked(project_id: uuid.UUID, db: AsyncSession) -> None:
    """Block project-wide plan changes while any activity is frozen by a revision
    awaiting approval.

    Used by operations that aren't tied to a single activity but still alter the
    plan under review — bulk CSV import and rig-contract edits (the contract is
    captured in the snapshot via its expiry).
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
