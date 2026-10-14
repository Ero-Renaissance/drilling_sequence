"""Lay out a new field project's wells on the calendar (the "Add project" flow).

Reuses the rig optimizer's rules (app/services/rig_optimizer.py ``Assumptions``)
so the two can never disagree:

- Durations are months at 30.44 days/month (2.5 months → 76 days).
- Wells on the SAME rig/HWU follow each other in the order listed: 2 weeks
  between wells, and 4 weeks after every 3rd well (replacing that 2-week gap).
  The batch counter works exactly like the optimizer's.
- Each resource's FIRST well starts on the project start date — unless the rig is
  still busy then, in which case it starts after that job plus the rig-move time
  between projects (45 days land, 30 swamp/offshore).
- A well with no rig/HWU starts on the project start date.

Anything that still overlaps (e.g. the rig has later work booked) is reported as
a conflict for the planner to resolve — never silently moved.
"""
import uuid
from dataclasses import dataclass
from datetime import date, timedelta

from app.models.activity import Activity
from app.schemas.project_wells import PlanConflict, PlannedWellIn, PlannedWellOut
from app.services.conflicts import resource_key
from app.services.rig_optimizer import Assumptions

DAYS_PER_MONTH = 30.44  # the optimizer's month length

# Activity.location → the optimizer's terrain names.
_TERRAIN = {"LAND": "Land", "SWAMP": "Swamp", "OFFSHORE": "SWO"}


def months_to_days(months: float) -> int:
    return max(1, round(months * DAYS_PER_MONTH))


@dataclass
class _Chain:
    free_from: date
    wells_since_batch_gap: int


def plan_project_wells(
    *,
    start_date: date,
    location: str,
    wells: list[PlannedWellIn],
    existing: list[Activity],
    assumptions: Assumptions = Assumptions(),
) -> list[PlannedWellOut]:
    terrain = _TERRAIN.get(location, "Land")
    chains: dict[tuple[str, str, str], _Chain] = {}
    planned: list[PlannedWellOut] = []

    for w in wells:
        rig = w.resource_name if w.resource_type == "rig" else None
        hwu = w.resource_name if w.resource_type == "hwu" else None
        probe = Activity(
            rig_name=rig,
            hwu_name=hwu,
            location=location,
            start_date=start_date,
            end_date=start_date,
        )
        key = resource_key(probe)
        days = months_to_days(w.duration_months)

        if key is None:
            start, gap, kind = start_date, 0, "none"
        elif key not in chains:
            # Is the resource still on a job when this project starts?
            busy_until = max(
                (
                    a.end_date
                    for a in existing
                    if a.completed_at is None
                    and resource_key(a) == key
                    and a.start_date <= start_date < a.end_date
                ),
                default=None,
            )
            if busy_until is None:
                start, gap, kind = start_date, 0, "none"
            else:
                gap, kind = assumptions.project_move_days(terrain), "project_move"
                start = max(busy_until + timedelta(days=gap), start_date)
            chains[key] = _Chain(free_from=start, wells_since_batch_gap=0)
        else:
            chain = chains[key]
            if chain.wells_since_batch_gap >= assumptions.batch_size:
                gap, kind = assumptions.batch_gap_days, "batch"
            else:
                gap, kind = assumptions.inter_well_gap_days, "inter_well"
            start = max(chain.free_from + timedelta(days=gap), start_date)

        end = start + timedelta(days=days)
        if key is not None:
            chain = chains[key]
            # As in the optimizer: a well after a batch gap (or the first on the
            # resource) is #1 of a fresh batch; otherwise it extends the batch.
            chain.wells_since_batch_gap = (
                chain.wells_since_batch_gap + 1 if kind == "inter_well" else 1
            )
            chain.free_from = end

        planned.append(
            PlannedWellOut(
                well_name=w.well_name,
                activity_type=w.activity_type,
                rig_name=rig,
                hwu_name=hwu,
                start_date=start,
                end_date=end,
                duration_days=days,
                gap_before_days=gap,
                gap_kind=kind,
            )
        )
    return planned


def plan_conflicts(
    planned: list[PlannedWellOut], location: str, existing: list[Activity]
) -> list[PlanConflict]:
    """Overlaps between each new well and existing (or earlier new) work on the
    same rig/HWU, using the app's resource identity (rigs: terrain + name; HWUs:
    name)."""
    others: list[tuple[Activity, str]] = [
        (a, a.well_name or a.activity_type) for a in existing if a.completed_at is None
    ]
    conflicts: list[PlanConflict] = []
    for p in planned:
        new = Activity(
            id=uuid.uuid4(),
            rig_name=p.rig_name,
            hwu_name=p.hwu_name,
            location=location,
            start_date=p.start_date,
            end_date=p.end_date,
        )
        key = resource_key(new)
        if key is not None:
            for other, label in others:
                if resource_key(other) != key:
                    continue
                overlap = (
                    min(new.end_date, other.end_date) - max(new.start_date, other.start_date)
                ).days
                if overlap > 0:
                    conflicts.append(
                        PlanConflict(
                            well_name=p.well_name,
                            resource=p.rig_name or p.hwu_name or "",
                            clashes_with=label,
                            overlap_days=overlap,
                        )
                    )
        others.append((new, p.well_name))
    return conflicts
