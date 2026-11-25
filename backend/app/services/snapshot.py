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
from app.models.resource_registry import ResourceRecord, normalize_resource_name
from app.models.rig_contract import RigContract
from app.services.readiness import resolve_activity_contract
from app.services.readiness_catalog import active_checks, governed_project_checks
from app.services.readiness_effective import (
    cell_status,
    load_index,
    not_selected,
    project_value,
    well_value,
)
from app.services.readiness_rollup import WELL_SCOPE


async def build_project_snapshot(project_id: uuid.UUID, db: AsyncSession) -> list[dict]:
    """Return the current activities of a project as snapshot dicts, ordered by
    start date. ``readiness`` carries the catalog's GOVERNED checks — the well
    execution readiness checks — at the value each activity's WELL shows (phase
    8): its own, else its field project's, else the default ("Not started").
    ``readiness_scope: "well"`` marks the format for readers."""
    act_result = await db.execute(
        select(Activity)
        .where(Activity.project_id == project_id)
        .order_by(Activity.start_date)
    )
    activities = list(act_result.scalars().all())
    if not activities:
        return []

    # The governed checks are per WELL since phase 8: each activity records what
    # its well shows — the well's own value, else its field project's. The
    # snapshot stays a flat activity list, so existing readers (diff, dashboard,
    # print) keep parsing.
    governed = await governed_project_checks(db)
    governed_index = await load_index(db, project_id, [c.code for c in governed])

    def governed_block(a: Activity) -> dict[str, str]:
        block: dict[str, str] = {}
        for c in governed:
            if c.applies_well and a.well_name:
                v = well_value(
                    governed_index, c, (a.well_project or "", a.well_name, a.activity_type)
                )
            elif a.well_project:
                v = project_value(governed_index, c, a.well_project)
            else:
                continue  # no well name and no field project: nothing to read
            block[c.code] = cell_status(v)
        return block

    # Live (operational) checks — Wells, Logistics… — are recorded too, as they
    # stood at submission, for the revision print; they never lock or diff.
    # Withdrawn checks (NEQ) are not active, so new snapshots don't carry them.
    operational = [c for c in await active_checks(db) if not c.locks_with_plan]
    index = await load_index(db, project_id, [c.code for c in operational])

    def at_submission(a: Activity) -> dict[str, dict]:
        if not a.readiness_required:  # opt-out: no readiness from any team
            return {}
        values: dict[str, dict] = {}
        for c in operational:
            # Spec §3.7: well-level checks — two-level ones included — need a well
            # name; project-only checks need a field project. As the live lens.
            if c.applies_well:
                if not a.well_name:
                    continue
                v = well_value(index, c, (a.well_project or "", a.well_name, a.activity_type))
            elif a.well_project:
                v = project_value(index, c, a.well_project)
            else:
                continue
            # Phase 7 (spec §6, §3.9): a check that is NOT SELECTED — it starts
            # unticked and no row ticks it here — carries nothing: left out, as
            # an omitted cell is, so an approver never sees 21 "not applicable"
            # equipment types.
            if not_selected(v):
                continue
            # Phase 6 (spec §6): a check that doesn't apply because of a row is
            # recorded as "N/A" — every revision reads an N/A team check as one
            # that didn't apply (no icon, not counted). No tags: Nominated
            # Equipment is withdrawn.
            values[c.code] = {"status": cell_status(v), "source": v.source}
            # How many of this type were needed at submission, where stated
            # (docs/equipment-quantity-spec.md §3.2) — only on a check that
            # applies. Recorded, never compared: it isn't part of the diff.
            if v.applies and v.quantity is not None:
                values[c.code]["quantity"] = v.quantity
        return values
    # Resource contracts (rig or HWU) drive the contract-expiry marker and are a
    # material part of the plan under approval, so capture each activity's contract
    # state.
    # Denormalised onto the activity (rather than a separate block) so the snapshot
    # stays a flat list and older stored revisions keep parsing.
    # Rig contracts are per PHYSICAL unit — keyed (normalized name, terrain), the
    # registry's case-insensitive identity, so a LAND and a SWAMP rig sharing a
    # name resolve to their own contracts ("" = legacy) and a casing variant of
    # one unit still finds its row (keys must match resolve_activity_contract).
    contracts_by_rig = {
        (normalize_resource_name(c.rig_name), (c.terrain or "").strip()): c
        for c in (
            await db.execute(
                select(RigContract).where(RigContract.project_id == project_id)
            )
        ).scalars().all()
    }
    contracts_by_hwu = {
        normalize_resource_name(c.hwu_name): c
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
            "market": a.market,
            "risk": a.risk,
            "comment": a.comment,
            # Per-activity readiness opt-out — carried so the print-out can suppress
            # its gate icons and the snapshot KPIs can exclude it. Older stored
            # revisions lack the key; readers default it to True.
            "readiness_required": a.readiness_required,
            # Lets the diff tell a finished activity (dropped on clone) apart
            # from one that was genuinely deleted while still open.
            "completed_at": a.completed_at.isoformat() if a.completed_at else None,
            # Each well's own value (phase 8); empty with neither a well name
            # nor a field project. The marker tells readers the block is the
            # well's, so the gate KPIs fold a field project's wells (worst of).
            "readiness": governed_block(a),
            "readiness_scope": WELL_SCOPE,
            "resource_planned": resource_planned(a),
            **contract_fields(a),
            # Only once live checks exist, so snapshots without them are unchanged.
            **({"readiness_at_submission": at_submission(a)} if operational else {}),
        }
        for a in activities
    ]
