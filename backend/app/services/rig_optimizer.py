"""Rig fleet optimization engine (docs/rig-optimization-spec.md).

Answers: the minimum number of rigs, per terrain, that delivers the committed
wells-per-project-per-year schedule under the agreed "Scenario 1" chain rules:

    well (2.5 mo) ─ 2 wks ─ well ─ 2 wks ─ well ─ 4 wks (after every 3rd) ─ …
    …and 45 days when a rig moves between projects in the same terrain.

Terrains are sealed fleets, so each terrain is solved independently. Within a
terrain the engine searches fleet sizes upward from 1; for each size it runs a
deterministic greedy simulation (earliest-finish rig wins each well, longest
projects scheduled first) and returns the first size with no missed deadline.
The simulation that failed at size N-1 supplies the "binding constraint" — the
first well that could not meet its year — so the answer is explainable.

Owned code only (no solver dependency). The optional MILP engine is selected via
settings.optimizer_engine but requires a solver library that has NOT been
adopted (IT review needed); until then it falls back here with a warning.

All durations are integer days; months are converted at 30.44 days/month by the
API layer's defaults (2.5 months → 76 days). Calendar arithmetic uses real
dates, so leap years and month lengths are exact.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date, timedelta

logger = logging.getLogger(__name__)

# Hard ceiling on the fleet search purely as a runaway guard; reached only if a
# single well can't meet its own deadline even on a dedicated rig (structural
# infeasibility), which is reported explicitly instead.
_MAX_RIGS_PER_TERRAIN = 500

# Display names for the hypothetical fleet ("SWO" — shallow water offshore —
# reads as plain "Offshore" in the UI, matching the sequence chart's band).
_RIG_NAME_PREFIX = {
    "Land": "Land Rig",
    "Swamp": "Swamp Rig",
    "SWO": "Offshore Rig",
}

# Canonical terrain presentation order — matches every Gantt in the app.
_TERRAIN_ORDER = {"Land": 0, "Swamp": 1, "SWO": 2}


@dataclass(frozen=True)
class Assumptions:
    """Scenario parameters — every value is frontend-editable (spec §4.2)."""

    well_duration_days: int = 76  # 2.5 months
    inter_well_gap_days: int = 14  # 2 weeks between wells in a project
    batch_size: int = 3  # wells per batch
    batch_gap_days: int = 28  # 4 weeks after each batch (replaces the 2 weeks)
    # Move between projects, same terrain — terrain-specific: land rigs take
    # 45 days; swamp and offshore (SWO) rigs 30.
    project_move_days_land: int = 45
    project_move_days_swamp: int = 30
    project_move_days_swo: int = 30
    rig_months_per_year: int = 12  # <12 inserts maintenance at each year start
    # Per-year calendar cutoff for COMPLETION: year → month (1–12) by whose end
    # that year's last well must be FINISHED drilling. Bounding the latest
    # completion bounds them all. Unlisted years (or month 12) behave as today.
    # A HARD operational date (flood season, security window, shutdown):
    # allow_slip_days never relaxes it, and it binds even under spudded
    # delivery — the spudded leniency applies only to uncut years.
    last_completion_month_by_year: dict[int, int] = field(default_factory=dict)

    def project_move_days(self, terrain: str) -> int:
        return {
            "Land": self.project_move_days_land,
            "Swamp": self.project_move_days_swamp,
            "SWO": self.project_move_days_swo,
        }.get(terrain, self.project_move_days_land)


@dataclass(frozen=True)
class Options:
    """Configurable relaxations — all default to the strict reading (spec §5)."""

    delivery: str = "finished"  # "finished" | "spudded"
    allow_slip_days: int = 0  # grace past 31 December
    allow_drill_ahead: bool = False  # may start before the committed year
    batch_reset_on_new_year: bool = False  # batch counter resets on 1 January


@dataclass(frozen=True)
class WellDemand:
    project: str
    year: int
    sequence: int  # 1-based well number within (project, year), for labelling


@dataclass
class ScheduledWell:
    project: str
    year: int  # committed year
    label: str
    start: date
    end: date  # exclusive of gaps; drilling window only
    gap_before_days: int
    gap_kind: str  # "none" | "inter_well" | "batch" | "project_move"


@dataclass
class RigPlan:
    name: str
    wells: list[ScheduledWell] = field(default_factory=list)


@dataclass
class TerrainResult:
    terrain: str
    feasible: bool
    rig_count: int
    rigs: list[RigPlan]
    rigs_active_per_year: dict[int, int]
    utilization_per_rig: dict[str, float]  # drilling days / horizon days
    binding: dict | None  # {"project", "year"} that forced the last rig
    infeasible_wells: list[dict]  # populated when feasible=False
    # Echo of the value-stream ordering this terrain was sequenced with (None
    # when no prioritization was requested) — results self-describe.
    priority_used: list[str] | None = None


# Value streams in field order of the per-project volume triple.
STREAMS = ("oil", "domestic_gas", "export_gas")
_STREAM_IDX = {s: i for i, s in enumerate(STREAMS)}

ProjectVolumes = dict[str, tuple[float, float, float]]  # project → (oil, dom, exp)


def priority_sort_key(
    project: str, volumes: ProjectVolumes, priority: list[str]
):
    """Lexicographic value key: rank by the highest-priority stream's volume,
    ties broken down the ordering. Streams are NEVER compared with each other
    (no barrels-vs-scf conversion) — only within-stream volumes compete."""
    v = volumes.get(project, (0.0, 0.0, 0.0))
    return tuple(-v[_STREAM_IDX[s]] for s in priority)


@dataclass
class _RigState:
    name: str
    free_from: date
    last_project: str | None = None
    wells_since_batch_gap: int = 0
    last_well_start: date | None = None
    maintained_years: set[int] = field(default_factory=set)
    plan: RigPlan = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        self.plan = RigPlan(name=self.name)


def _year_start(year: int) -> date:
    return date(year, 1, 1)


def _year_end(year: int) -> date:
    return date(year, 12, 31)


def _month_end(year: int, month: int) -> date:
    if month >= 12:
        return date(year, 12, 31)
    return date(year, month + 1, 1) - timedelta(days=1)


def _maintenance_days(assumptions: Assumptions) -> int:
    idle_months = max(0, 12 - assumptions.rig_months_per_year)
    return round(idle_months * 30.44)


def _candidate(
    rig: _RigState,
    well: WellDemand,
    terrain: str,
    assumptions: Assumptions,
    options: Options,
    horizon_start: date,
) -> tuple[date, int, str, bool] | None:
    """Earliest (start, gap_days, gap_kind, batch_reset) this rig could give the
    well, or None if even the earliest start misses the well's deadline."""
    earliest_allowed = (
        horizon_start if options.allow_drill_ahead else _year_start(well.year)
    )

    batch_reset = False
    if rig.last_project is None:
        gap_days, gap_kind = 0, "none"  # day-one availability (spec §9.3)
    elif rig.last_project == well.project:
        counter = rig.wells_since_batch_gap
        if options.batch_reset_on_new_year and rig.last_well_start is not None:
            # Optional 1-January reset: if this well cannot start until a later
            # calendar year than the previous well started in, the chain crossed
            # New Year and the batch count starts fresh.
            probe = max(rig.free_from, earliest_allowed)
            if probe.year > rig.last_well_start.year:
                counter = 0
                batch_reset = True
        if counter >= assumptions.batch_size:
            gap_days, gap_kind = assumptions.batch_gap_days, "batch"
        else:
            gap_days, gap_kind = assumptions.inter_well_gap_days, "inter_well"
    else:
        gap_days, gap_kind = assumptions.project_move_days(terrain), "project_move"

    # A move/gap can elapse while the rig would otherwise idle, so the gap pushes
    # the start only when the rig frees up too late — hence max(), not sum-then-max.
    start = max(rig.free_from + timedelta(days=gap_days), earliest_allowed)

    # Optional maintenance block at each calendar-year start (availability < 12).
    maint = _maintenance_days(assumptions)
    if maint and start.year not in rig.maintained_years:
        start = max(start, _year_start(start.year) + timedelta(days=maint))

    deadline = _year_end(well.year) + timedelta(days=options.allow_slip_days)
    if options.delivery == "spudded":
        if start > deadline:
            return None
    else:  # finished in-year (default)
        if start + timedelta(days=assumptions.well_duration_days) > deadline:
            return None
    # Per-year completion cutoff: a HARD calendar bound on the FINISH.
    # Enforced regardless of delivery policy and never relaxed by slip.
    cutoff = assumptions.last_completion_month_by_year.get(well.year)
    if cutoff and cutoff < 12:
        hard_end = _month_end(well.year, cutoff)
        if start + timedelta(days=assumptions.well_duration_days) > hard_end:
            return None
    return start, gap_days, gap_kind, batch_reset


def _simulate(
    terrain: str,
    wells: list[WellDemand],
    n_rigs: int,
    assumptions: Assumptions,
    options: Options,
    horizon_start: date,
) -> tuple[list[_RigState], list[dict]]:
    """Greedy assignment of every well onto n_rigs rigs: the rig offering the
    earliest start wins (durations are uniform, so earliest start == earliest
    finish). Returns (rigs, missed_wells); feasible iff missed_wells is empty."""
    prefix = _RIG_NAME_PREFIX.get(terrain, f"{terrain} Rig")
    rigs = [
        _RigState(name=f"{prefix} {i + 1}", free_from=horizon_start)
        for i in range(n_rigs)
    ]
    missed: list[dict] = []
    for well in wells:
        best: tuple[date, int, str, bool, _RigState] | None = None
        for rig in rigs:
            cand = _candidate(rig, well, terrain, assumptions, options, horizon_start)
            if cand is None:
                continue
            start, gap_days, gap_kind, batch_reset = cand
            if best is None or start < best[0]:
                best = (start, gap_days, gap_kind, batch_reset, rig)
        if best is None:
            missed.append({"project": well.project, "year": well.year})
            continue
        start, gap_days, gap_kind, batch_reset, rig = best
        end = start + timedelta(days=assumptions.well_duration_days)
        rig.plan.wells.append(
            ScheduledWell(
                project=well.project,
                year=well.year,
                label=f"{well.project} · {well.year} · Well {well.sequence}",
                start=start,
                end=end,
                gap_before_days=gap_days,
                gap_kind=gap_kind,
            )
        )
        # Batch counter: this well is #1 of a fresh batch after a batch gap, a
        # project switch, a first-ever well, or a New-Year reset; otherwise it
        # extends the running batch.
        continuing = (
            rig.last_project == well.project
            and gap_kind == "inter_well"
            and not batch_reset
        )
        rig.wells_since_batch_gap = rig.wells_since_batch_gap + 1 if continuing else 1
        if _maintenance_days(assumptions):
            rig.maintained_years.add(start.year)
        rig.last_project = well.project
        rig.last_well_start = start
        rig.free_from = end
    return rigs, missed


def optimize_terrain(
    terrain: str,
    demand: dict[str, dict[int, int]],  # project -> {year: wells}
    assumptions: Assumptions,
    options: Options,
    volumes: ProjectVolumes | None = None,
    priority: list[str] | None = None,
) -> TerrainResult:
    """Find the minimum rig fleet for one terrain (spec §3, §6)."""
    years = sorted({y for by_year in demand.values() for y in by_year if by_year[y]})
    if not years:
        used = list(priority) if priority else None
        return TerrainResult(terrain, True, 0, [], {}, {}, None, [], used)
    horizon_start = _year_start(years[0])
    horizon_end = _year_end(years[-1])
    horizon_days = (horizon_end - horizon_start).days + 1

    # Well list: by committed year; within a year, the value-priority key when
    # an ordering is active (higher-priority-stream volume first — earlier rig
    # slots go to the projects the business ranks first), then longest project
    # first (LPT) so big chains start early, then stable by name. Rig count
    # remains the primary objective: the fleet-size search below still finds
    # the smallest feasible fleet under this sequencing.
    totals = {p: sum(by_year.values()) for p, by_year in demand.items()}
    if priority:
        vol_key = lambda p: priority_sort_key(p, volumes or {}, priority)  # noqa: E731
    else:
        vol_key = lambda p: ()  # noqa: E731
    wells: list[WellDemand] = []
    for project in sorted(demand, key=lambda p: (*vol_key(p), -totals[p], p)):
        for year in sorted(demand[project]):
            for seq in range(demand[project][year]):
                wells.append(WellDemand(project=project, year=year, sequence=seq + 1))
    wells.sort(
        key=lambda w: (w.year, *vol_key(w.project), -totals[w.project], w.project, w.sequence)
    )

    binding: dict | None = None
    previous_missed: list[dict] = []
    for n in range(1, min(len(wells), _MAX_RIGS_PER_TERRAIN) + 1):
        rigs, missed = _simulate(terrain, wells, n, assumptions, options, horizon_start)
        if missed:
            previous_missed = missed
            continue
        if n > 1 and previous_missed:
            binding = previous_missed[0]  # what N-1 rigs could not deliver
        active: dict[int, int] = {}
        utilization: dict[str, float] = {}
        for rig in rigs:
            drilling = sum((w.end - w.start).days for w in rig.plan.wells)
            utilization[rig.name] = round(drilling / horizon_days, 3)
            for y in years:
                if any(
                    w.start <= _year_end(y) and w.end >= _year_start(y)
                    for w in rig.plan.wells
                ):
                    active[y] = active.get(y, 0) + 1
        return TerrainResult(
            terrain=terrain,
            feasible=True,
            rig_count=n,
            rigs=[r.plan for r in rigs],
            rigs_active_per_year={y: active.get(y, 0) for y in years},
            utilization_per_rig=utilization,
            binding=binding,
            infeasible_wells=[],
            priority_used=list(priority) if priority else None,
        )

    # Even one rig per well can't meet some deadline: structurally infeasible.
    _, missed = _simulate(
        terrain, wells, min(len(wells), _MAX_RIGS_PER_TERRAIN), assumptions, options, horizon_start
    )
    logger.warning(
        "rig optimization infeasible terrain=%s missed=%d", terrain, len(missed)
    )
    return TerrainResult(
        terrain=terrain,
        feasible=False,
        rig_count=0,
        rigs=[],
        rigs_active_per_year={},
        utilization_per_rig={},
        binding=None,
        infeasible_wells=missed,
        priority_used=list(priority) if priority else None,
    )


def optimize(
    demand_rows: list[dict],  # [{terrain, project, wells_by_year}]
    assumptions: Assumptions,
    options: Options,
    priority_by_terrain: dict[str, list[str]] | None = None,
) -> list[TerrainResult]:
    """Solve each terrain independently (rigs never cross terrains, spec §3.1)."""
    by_terrain: dict[str, dict[str, dict[int, int]]] = {}
    volumes_by_terrain: dict[str, ProjectVolumes] = {}
    for row in demand_rows:
        by_terrain.setdefault(row["terrain"], {})[row["project"]] = {
            int(y): int(n) for y, n in row["wells_by_year"].items() if int(n) > 0
        }
        volumes_by_terrain.setdefault(row["terrain"], {})[row["project"]] = (
            float(row.get("oil_volume") or 0),
            float(row.get("domestic_gas_volume") or 0),
            float(row.get("export_gas_volume") or 0),
        )
    return [
        optimize_terrain(
            terrain,
            projects,
            assumptions,
            options,
            volumes=volumes_by_terrain.get(terrain),
            priority=(priority_by_terrain or {}).get(terrain),
        )
        for terrain, projects in sorted(
            by_terrain.items(), key=lambda kv: (_TERRAIN_ORDER.get(kv[0], 99), kv[0])
        )
    ]


def run(
    demand_rows: list[dict],
    assumptions: Assumptions,
    options: Options,
    engine: str = "heuristic",
    priority_by_terrain: dict[str, list[str]] | None = None,
) -> tuple[list[TerrainResult], str, str | None]:
    """Run the requested engine, returning (results, engine_used, warning).

    The heuristic is always available. The exact "milp" engine is used only when
    OR-Tools is installed AND the selected options are supported; otherwise it
    degrades to the heuristic and returns a warning explaining why — so setting
    OPTIMIZER_ENGINE=milp is always safe.
    """
    engine = (engine or "heuristic").strip().lower()
    if engine != "milp":
        return optimize(demand_rows, assumptions, options, priority_by_terrain), "heuristic", None

    from app.services import rig_optimizer_milp as milp

    ok, unsupported = milp.supports(options)
    if not ok:
        return (
            optimize(demand_rows, assumptions, options, priority_by_terrain),
            "heuristic",
            f"The exact engine doesn't model {', '.join(unsupported)}; "
            "results computed with the heuristic engine.",
        )
    try:
        return (
            milp.optimize_milp(demand_rows, assumptions, options, priority_by_terrain),
            "milp",
            None,
        )
    except milp.SolverUnavailable:
        logger.warning("optimizer_engine=milp requested but OR-Tools missing")
        return (
            optimize(demand_rows, assumptions, options, priority_by_terrain),
            "heuristic",
            "MILP engine is configured but OR-Tools is not installed; "
            "results computed with the heuristic engine.",
        )
