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

Editing an existing project (``plan_project_edit``) keeps every existing well's
dates as the planner left them; only NEW wells are placed, continuing each rig's
chain after the project's last well on it. A re-sequence lays every open well out
again from a start date, keeping each well's duration. Completed wells are
actuals: never moved, and only their project-level details may change.
"""
import uuid
from dataclasses import dataclass, field, fields
from datetime import date, timedelta

from app.models.activity import Activity
from app.schemas.project_wells import (
    EditedWellOut,
    PlanConflict,
    PlannedWellIn,
    PlannedWellOut,
    ProjectWellsEditIn,
    ProjectWellsEditPlan,
    RemovedWellOut,
)
from app.services.conflicts import resource_key
from app.services.rig_optimizer import Assumptions

DAYS_PER_MONTH = 30.44  # the optimizer's month length

# Activity.location → the optimizer's terrain names.
_TERRAIN = {"LAND": "Land", "SWAMP": "Swamp", "OFFSHORE": "SWO"}

ResourceKey = tuple[str, str, str]


def months_to_days(months: float) -> int:
    return max(1, round(months * DAYS_PER_MONTH))


@dataclass(frozen=True)
class WellSpec:
    """One well to place: its names, its resource and terrain, and its rig time."""

    well_name: str
    activity_type: str
    rig_name: str | None
    hwu_name: str | None
    location: str | None
    days: int


@dataclass
class _Chain:
    free_from: date
    wells_since_batch_gap: int


def _key_of(rig: str | None, hwu: str | None, location: str | None) -> ResourceKey | None:
    # The app's resource identity (rigs: terrain + name; HWUs: name).
    probe = Activity(
        rig_name=rig, hwu_name=hwu, location=location, start_date=date.min, end_date=date.min
    )
    return resource_key(probe)


def seed_chains(
    kept: list[tuple[ResourceKey, date]], assumptions: Assumptions = Assumptions()
) -> dict[ResourceKey, _Chain]:
    """Chains for wells already on the calendar, so a new well continues after
    the project's last well on its rig. The batch counter assumes those n wells
    followed the gap rules: ((n - 1) mod batch size) + 1."""
    ends: dict[ResourceKey, list[date]] = {}
    for key, end in kept:
        ends.setdefault(key, []).append(end)
    return {
        key: _Chain(
            free_from=max(dates),
            wells_since_batch_gap=(len(dates) - 1) % assumptions.batch_size + 1,
        )
        for key, dates in ends.items()
    }


def place_wells(
    specs: list[WellSpec],
    *,
    start_date: date,
    existing: list[Activity],
    chains: dict[ResourceKey, _Chain] | None = None,
    assumptions: Assumptions = Assumptions(),
) -> list[PlannedWellOut]:
    """Lay ``specs`` out in order with the optimizer's gap rules (module doc).
    ``chains`` continues resources that already have this project's wells."""
    chains = {k: _Chain(c.free_from, c.wells_since_batch_gap) for k, c in (chains or {}).items()}
    planned: list[PlannedWellOut] = []

    for w in specs:
        key = _key_of(w.rig_name, w.hwu_name, w.location)
        terrain = _TERRAIN.get(w.location or "", "Land")

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

        end = start + timedelta(days=w.days)
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
                rig_name=w.rig_name,
                hwu_name=w.hwu_name,
                start_date=start,
                end_date=end,
                duration_days=w.days,
                gap_before_days=gap,
                gap_kind=kind,
            )
        )
    return planned


def plan_project_wells(
    *,
    start_date: date,
    location: str,
    wells: list[PlannedWellIn],
    existing: list[Activity],
    assumptions: Assumptions = Assumptions(),
) -> list[PlannedWellOut]:
    specs = [
        WellSpec(
            well_name=w.well_name,
            activity_type=w.activity_type,
            rig_name=w.resource_name if w.resource_type == "rig" else None,
            hwu_name=w.resource_name if w.resource_type == "hwu" else None,
            location=location,
            days=months_to_days(w.duration_months),
        )
        for w in wells
    ]
    return place_wells(specs, start_date=start_date, existing=existing, assumptions=assumptions)


def conflicts_for(
    rows: list[tuple[PlannedWellOut, str | None]], existing: list[Activity]
) -> list[PlanConflict]:
    """Overlaps between each row (a well and its terrain) and existing work — or
    an earlier row — on the same rig/HWU."""
    others: list[tuple[Activity, str]] = [
        (a, a.well_name or a.activity_type) for a in existing if a.completed_at is None
    ]
    conflicts: list[PlanConflict] = []
    for p, location in rows:
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


def plan_conflicts(
    planned: list[PlannedWellOut], location: str, existing: list[Activity]
) -> list[PlanConflict]:
    """Overlaps for a new project's wells, all on one terrain."""
    return conflicts_for([(p, location) for p in planned], existing)


# ── Editing an existing project ─────────────────────────────────────────────

# Fields set once for the whole project; absent from the request → each well
# keeps its own value ("Mixed").
PROJECT_FIELDS = ("location", "plan_type", "risk", "market", "readiness_required")
# A completed well's own fields — its actuals, which an edit may not change.
_WELL_FIELDS = ("well_name", "activity_type", "rig_name", "hwu_name", "start_date", "end_date")


class EditRefused(ValueError):
    """The edit breaks a business rule; the message is safe to show the planner."""


@dataclass
class WellValues:
    """Every field a well ends up with after the edit (an Activity's columns)."""

    well_project: str
    well_name: str
    activity_type: str
    rig_name: str | None
    hwu_name: str | None
    start_date: date | None  # None until a new well is placed
    end_date: date | None
    location: str | None
    plan_type: str | None
    risk: str | None
    market: str | None
    readiness_required: bool | None

    def as_columns(self) -> dict[str, object]:
        return {f.name: getattr(self, f.name) for f in fields(self)}


@dataclass
class WellEdit:
    activity: Activity | None  # None → a new well
    values: WellValues
    changes: dict[str, tuple[object, object]]  # field → (old, new); new wells: {}
    out: EditedWellOut


@dataclass
class ProjectEdit:
    name: str
    renamed: bool
    wells: list[WellEdit]
    removed: list[Activity]
    conflicts: list[PlanConflict] = field(default_factory=list)

    @property
    def changed(self) -> bool:
        return bool(
            self.removed or any(w.activity is None or w.changes for w in self.wells)
        )

    def plan(self, *, saved: bool = False) -> ProjectWellsEditPlan:
        return ProjectWellsEditPlan(
            well_project=self.name,
            wells=[w.out for w in self.wells],
            removed=[
                RemovedWellOut(id=a.id, well_name=a.well_name, activity_type=a.activity_type)
                for a in self.removed
            ],
            conflicts=self.conflicts,
            saved=saved,
        )


def _spec(v: WellValues, days: int) -> WellSpec:
    return WellSpec(
        well_name=v.well_name,
        activity_type=v.activity_type,
        rig_name=v.rig_name,
        hwu_name=v.hwu_name,
        location=v.location,
        days=days,
    )


def _span(v: WellValues) -> int:
    assert v.start_date is not None and v.end_date is not None
    return (v.end_date - v.start_date).days


def plan_project_edit(
    payload: ProjectWellsEditIn,
    project_wells: list[Activity],
    others: list[Activity],
    assumptions: Assumptions = Assumptions(),
) -> ProjectEdit:
    """Work out what the edit does — every well's target values, the dates of
    new (or re-sequenced) wells, what changes and what clashes — without writing.

    ``project_wells`` are the project's activities (each one listed in
    ``payload.wells`` or ``payload.removed`` — the caller checks that);
    ``others`` is the rest of the campaign.
    """
    by_id = {a.id: a for a in project_wells}
    name = payload.new_name or payload.well_project
    set_fields = {f: getattr(payload, f) for f in PROJECT_FIELDS if f in payload.model_fields_set}

    removed = [by_id[r.id] for r in payload.removed]
    for a in removed:
        if a.completed_at is not None:
            raise EditRefused(f"{a.well_name or a.activity_type} is completed and can't be removed")

    # A new well takes the project's details: those set in this edit, else the
    # first listed existing well's — or, when every original well is being
    # replaced, the project's earliest well's (removed or not).
    earliest = min(project_wells, key=lambda a: a.start_date, default=None)
    template = next((by_id[w.id] for w in payload.wells if w.id is not None), earliest)

    def project_value(f: str, act: Activity | None) -> object:
        if f in set_fields:
            return set_fields[f]
        source = act or template
        return getattr(source, f) if source is not None else None

    # 1. Each row's target values, before any layout.
    rows: list[tuple[Activity | None, WellValues]] = []
    for w in payload.wells:
        act = by_id[w.id] if w.id is not None else None
        values = WellValues(
            well_project=name,
            well_name=w.well_name,
            activity_type=w.activity_type,
            rig_name=w.resource_name if w.resource_type == "rig" else None,
            hwu_name=w.resource_name if w.resource_type == "hwu" else None,
            start_date=w.start_date,
            end_date=w.end_date,
            **{f: project_value(f, act) for f in PROJECT_FIELDS},  # type: ignore[arg-type]
        )
        if act is None:
            missing = [
                f.replace("_", " ")
                for f in ("location", "plan_type", "risk")
                if getattr(values, f) is None
            ]
            if missing:
                raise EditRefused(f"Set the project's {', '.join(missing)} before adding wells")
            if values.readiness_required is None:
                values.readiness_required = True
        elif act.completed_at is not None and any(
            getattr(values, f) != getattr(act, f) for f in _WELL_FIELDS
        ):
            raise EditRefused(
                f"{act.well_name or act.activity_type} is completed: only the project's "
                "details can change, not the well itself"
            )
        rows.append((act, values))

    # One readiness key per well + activity (spec §7.2) — but only for keys this
    # edit introduces: existing activities that already share a key keep it.
    by_key: dict[tuple[str, str], list[tuple[Activity | None, WellValues]]] = {}
    for act, values in rows:
        by_key.setdefault((values.well_name, values.activity_type), []).append((act, values))
    for (well, activity_type), sharing in by_key.items():
        if len(sharing) > 1 and any(
            act is None or (act.well_name, act.activity_type) != (well, activity_type)
            for act, _ in sharing
        ):
            raise EditRefused(f"{well} is listed twice with activity {activity_type}")

    def new_days(i: int) -> int:
        return months_to_days(payload.wells[i].duration_months or 0)

    # 2. Dates. Kept wells stay put; new wells are placed by the gap rules. A
    # re-sequence lays every open well out again, in list order, keeping each
    # existing well's duration.
    placed: dict[int, PlannedWellOut] = {}
    if payload.layout == "resequence":
        assert payload.start_date is not None  # schema-enforced
        open_rows = [
            i for i, (act, _) in enumerate(rows) if act is None or act.completed_at is None
        ]
        specs = [
            _spec(rows[i][1], new_days(i) if rows[i][0] is None else _span(rows[i][1]))
            for i in open_rows
        ]
        laid = place_wells(
            specs, start_date=payload.start_date, existing=others, assumptions=assumptions
        )
        placed = dict(zip(open_rows, laid, strict=True))
    else:
        new_rows = [i for i, (act, _) in enumerate(rows) if act is None]
        if new_rows:
            kept = [v for act, v in rows if act is not None]
            # The project's start: its earliest kept well, else (every original
            # well replaced) its earliest original one.
            start = (
                payload.start_date
                or min((v.start_date for v in kept if v.start_date is not None), default=None)
                or (earliest.start_date if earliest is not None else None)
            )
            if start is None:
                raise EditRefused("Give a start date for the new wells")
            chains = seed_chains(
                [
                    (key, v.end_date)
                    for v in kept
                    if v.end_date is not None
                    and (key := _key_of(v.rig_name, v.hwu_name, v.location)) is not None
                ],
                assumptions,
            )
            laid = place_wells(
                [_spec(rows[i][1], new_days(i)) for i in new_rows],
                start_date=start,
                existing=others,
                chains=chains,
                assumptions=assumptions,
            )
            placed = dict(zip(new_rows, laid, strict=True))

    # 3. Outcomes: what each row becomes, what changes, what clashes.
    edits: list[WellEdit] = []
    for i, (act, values) in enumerate(rows):
        gap, kind = 0, "kept"
        if i in placed:
            p = placed[i]
            values.start_date, values.end_date = p.start_date, p.end_date
            gap, kind = p.gap_before_days, p.gap_kind
        columns = values.as_columns()
        changes = (
            {}
            if act is None
            else {
                f: (getattr(act, f), new)
                for f, new in columns.items()
                if getattr(act, f) != new
            }
        )
        assert values.start_date is not None and values.end_date is not None
        out = EditedWellOut(
            id=act.id if act is not None else None,
            well_name=values.well_name,
            activity_type=values.activity_type,
            rig_name=values.rig_name,
            hwu_name=values.hwu_name,
            start_date=values.start_date,
            end_date=values.end_date,
            duration_days=_span(values),
            gap_before_days=gap,
            gap_kind=kind,  # type: ignore[arg-type]
            change="new" if act is None else ("changed" if changes else "unchanged"),
            completed=act is not None and act.completed_at is not None,
        )
        edits.append(WellEdit(activity=act, values=values, changes=changes, out=out))

    return ProjectEdit(
        name=name,
        renamed=name != payload.well_project,
        wells=edits,
        removed=removed,
        conflicts=conflicts_for(
            [(e.out, e.values.location) for e in edits if not e.out.completed], others
        ),
    )
