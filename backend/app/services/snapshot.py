"""Build a point-in-time snapshot of a project's activities + readiness.

The same shape backs both stored revisions (`Revision.snapshot_json`) and the
live-plan side of a comparison, so a revision and the working plan can be diffed
against each other field-for-field.
"""
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.readiness import CHECK_CODES, ReadinessCheck


async def build_project_snapshot(project_id: uuid.UUID, db: AsyncSession) -> list[dict]:
    """Return the current activities of a project as snapshot dicts, ordered by
    start date. Readiness defaults to "Not Started" for any unset gate."""
    act_result = await db.execute(
        select(Activity)
        .where(Activity.project_id == project_id)
        .order_by(Activity.start_date)
    )
    activities = list(act_result.scalars().all())
    if not activities:
        return []

    activity_ids = [a.id for a in activities]
    checks_result = await db.execute(
        select(ReadinessCheck).where(ReadinessCheck.activity_id.in_(activity_ids))
    )
    checks_by_activity: dict[uuid.UUID, dict[str, str]] = {}
    for check in checks_result.scalars().all():
        checks_by_activity.setdefault(check.activity_id, {})[check.check_code] = check.status

    return [
        {
            "id": str(a.id),
            # Coalesce: rows predating lineage tracking match by their own id.
            "lineage_id": str(a.lineage_id or a.id),
            "activity_type": a.activity_type,
            "start_date": a.start_date.isoformat(),
            "end_date": a.end_date.isoformat(),
            "well_name": a.well_name,
            "rig_name": a.rig_name,
            "location": a.location,
            "plan_type": a.plan_type,
            "risk": a.risk,
            "comment": a.comment,
            # Lets the diff tell a finished activity (dropped on clone) apart
            # from one that was genuinely deleted while still open.
            "completed_at": a.completed_at.isoformat() if a.completed_at else None,
            "readiness": {
                code: checks_by_activity.get(a.id, {}).get(code, "Not Started")
                for code in CHECK_CODES
            },
        }
        for a in activities
    ]
