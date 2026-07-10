"""Build a point-in-time snapshot of a project's activities + readiness.

The same shape backs both stored revisions (`Revision.snapshot_json`) and the
live-plan side of a comparison, so a revision and the working plan can be diffed
against each other field-for-field.
"""
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.hwu_contract import HwuContract
from app.models.readiness import CHECK_CODES, ReadinessCheck
from app.models.resource_registry import ResourceRecord, normalize_resource_name
from app.models.rig_contract import RigContract
from app.services.readiness import resolve_activity_contract


async def build_project_snapshot(project_id: uuid.UUID, db: AsyncSession) -> list[dict]:
    """Return the current activities of a project as snapshot dicts, ordered by
    start date. Readiness defaults to "On Track" for any unset gate."""
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

    # Resource contracts (rig or HWU) drive the contract-expiry marker and are a
    # material part of the plan under approval, so capture each activity's contract
    # state.
    # Denormalised onto the activity (rather than a separate block) so the snapshot
    # stays a flat list and older stored revisions keep parsing.
    # Rig contracts are per PHYSICAL unit — keyed (name, terrain) so a LAND and
    # a SWAMP rig sharing a name resolve to their own contracts ("" = legacy).
    contracts_by_rig = {
        (c.rig_name, c.terrain or ""): c
        for c in (
            await db.execute(
                select(RigContract).where(RigContract.project_id == project_id)
            )
        ).scalars().all()
    }
    contracts_by_hwu = {
        c.hwu_name: c
        for c in (
            await db.execute(
                select(HwuContract).where(HwuContract.project_id == project_id)
            )
        ).scalars().all()
    }

    # Whether each activity's unit is a PLANNED (placeholder) slot at snapshot
    # time — captured so the approved record can split fleet demand into
    # procured vs planned. Older stored revisions lack the key; readers treat
    # that as "not planned".
    registry = (
        await db.execute(
            select(ResourceRecord).where(ResourceRecord.project_id == project_id)
        )
    ).scalars().all()
    planned_rig_keys = {
        (r.terrain, r.name_key) for r in registry if r.kind == "rig" and r.is_placeholder
    }
    planned_hwu_keys = {r.name_key for r in registry if r.kind == "hwu" and r.is_placeholder}

    def resource_planned(activity: Activity) -> bool:
        if activity.rig_name:
            key = ((activity.location or "").strip(), normalize_resource_name(activity.rig_name))
            return key in planned_rig_keys
        if activity.hwu_name:
            return normalize_resource_name(activity.hwu_name) in planned_hwu_keys
        return False

    def contract_fields(activity: Activity) -> dict:
        # The activity's resource contract — its rig's or its HWU's. Kept under the
        # rig_contract_* keys so the print-out, KPIs and diff read one set of fields
        # regardless of resource type, and older stored revisions keep parsing.
        contract = resolve_activity_contract(activity, contracts_by_rig, contracts_by_hwu)
        return {
            "rig_contract_start": (
                contract.contract_start.isoformat()
                if contract and contract.contract_start
                else None
            ),
            "rig_contract_end": (
                contract.contract_end.isoformat()
                if contract and contract.contract_end
                else None
            ),
        }

    return [
        {
            "id": str(a.id),
            # Coalesce: rows predating lineage tracking match by their own id.
            "lineage_id": str(a.lineage_id or a.id),
            "activity_type": a.activity_type,
            "start_date": a.start_date.isoformat(),
            "end_date": a.end_date.isoformat(),
            "well_name": a.well_name,
            "well_project": a.well_project,
            "rig_name": a.rig_name,
            "hwu_name": a.hwu_name,
            "location": a.location,
            "plan_type": a.plan_type,
            "risk": a.risk,
            "comment": a.comment,
            # Per-activity readiness opt-out — carried so the print-out can suppress
            # its gate icons and the snapshot KPIs can exclude it. Older stored
            # revisions lack the key; readers default it to True.
            "readiness_required": a.readiness_required,
            # Lets the diff tell a finished activity (dropped on clone) apart
            # from one that was genuinely deleted while still open.
            "completed_at": a.completed_at.isoformat() if a.completed_at else None,
            "readiness": {
                code: checks_by_activity.get(a.id, {}).get(code, "On Track")
                for code in CHECK_CODES
            },
            "resource_planned": resource_planned(a),
            **contract_fields(a),
        }
        for a in activities
    ]
