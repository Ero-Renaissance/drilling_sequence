"""Exact rig-fleet optimizer via Google OR-Tools CP-SAT (the "milp" engine).

Optional: OR-Tools is the `solver` extra and is NOT installed by default. The
orchestrator (rig_optimizer.run) falls back to the heuristic when this module
can't run — either because OR-Tools is absent (SolverUnavailable) or because the
selected relaxation options aren't supported here (see `supports`).

## Model

Under the strict in-year policy — a well committed to year Y is *drilled and
finished within Y* (day-one availability, no drill-ahead, no slip) — the problem
**decomposes by year**: no rig-time usefully crosses a year boundary, because
year Y's wells can't start before 1 Jan Y and must finish by 31 Dec Y. So the
minimum fleet for a terrain is the peak over years of the minimum rigs that year,
and each year is an independent bin-packing:

- A rig's *load* for the year = Σ_project block(k wells of that project on the
  rig) + move × (distinct projects on the rig − 1), where block(k) is the
  deterministic chain length k·duration + the 2-week / 4-week-every-batch gaps.
- Capacity = days in the year − maintenance days (when availability < 12 mo/yr).
- Minimise the number of rigs used; wells of one project may split across rigs
  (concurrency is allowed, spec §9.1).

CP-SAT solves each year's packing to proven optimality (these are tiny — a few
projects, tens of wells). This is exact for the strict policy and never exceeds
the heuristic's fleet; on cases where the greedy over-assigns, it returns fewer
rigs. The relaxations that couple years together (spudded delivery, drill-ahead,
slip) are out of scope here and trigger the heuristic fallback.

Because the model treats each committed year independently, a project's batch
counter naturally restarts each year — consistent with the year-boundary idle
break; equivalent to batch_reset_on_new_year for cross-year runs.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta

from app.services.rig_optimizer import (
    _RIG_NAME_PREFIX,
    _TERRAIN_ORDER,
    Assumptions,
    Options,
    ProjectVolumes,
    RigPlan,
    ScheduledWell,
    TerrainResult,
    _maintenance_days,
    _year_start,
    priority_sort_key,
)

logger = logging.getLogger(__name__)


class SolverUnavailable(RuntimeError):
    """OR-Tools is not installed — caller should fall back to the heuristic."""


def supports(options: Options) -> tuple[bool, list[str]]:
    """Whether the exact engine models the selected options. The year-decomposed
    formulation is valid only for the strict in-year policy; relaxations that
    couple adjacent years fall back to the heuristic."""
    unsupported: list[str] = []
    if options.delivery != "finished":
        unsupported.append("spudded delivery")
    if options.allow_drill_ahead:
        unsupported.append("drill-ahead")
    if options.allow_slip_days > 0:
        unsupported.append("slip past year-end")
    return (not unsupported, unsupported)


def _block_days(count: int, a: Assumptions) -> int:
    """Rig-days for `count` consecutive wells of one project: the drilling time
    plus the inter-well gaps, with the batch gap replacing every batch_size-th."""
    if count <= 0:
        return 0
    total = count * a.well_duration_days
    for k in range(1, count):  # gap after well k (1-based), for k = 1..count-1
        total += a.batch_gap_days if k % a.batch_size == 0 else a.inter_well_gap_days
    return total


def _days_in_year(year: int) -> int:
    return (date(year, 12, 31) - date(year, 1, 1)).days + 1


def _completion_window_days(year: int, month: int | None) -> int:
    """Days from 1 January through the last day of `month` — the window inside
    which the year's wells must COMPLETE. None / 12 = the full year."""
    if not month or month >= 12:
        return _days_in_year(year)
    return (date(year, month + 1, 1) - date(year, 1, 1)).days


def _pack_year(
    project_counts: dict[str, int], capacity: int, move: int, a: Assumptions
) -> dict[str, int] | None:
    """Minimum-rig bin-packing for one year. Returns {project: [wells on rig 0,
    rig 1, …]} as a per-rig assignment, or None if a single well can't fit the
    year (structural infeasibility). Raises SolverUnavailable if OR-Tools missing."""
    try:
        from ortools.sat.python import cp_model
    except ImportError as exc:  # pragma: no cover - exercised via the fallback test
        raise SolverUnavailable("OR-Tools (ortools) is not installed") from exc

    projects = sorted(project_counts)
    # A single well always its own rig is the worst case → upper bound on rigs.
    max_rigs = sum(project_counts.values())
    if max_rigs == 0:
        return {}
    # Structural infeasibility: one well alone overruns the year window.
    if any(_block_days(1, a) > capacity for _ in projects):
        return None

    model = cp_model.CpModel()
    # a_var[p][r] = wells of project p on rig r.
    a_var: dict[str, list] = {}
    present: dict[str, list] = {}
    block_var: dict[str, list] = {}
    for p in projects:
        cp = project_counts[p]
        table = [_block_days(m, a) for m in range(cp + 1)]
        a_var[p] = [model.NewIntVar(0, cp, f"a_{p}_{r}") for r in range(max_rigs)]
        present[p] = [model.NewBoolVar(f"pr_{p}_{r}") for r in range(max_rigs)]
        block_var[p] = [
            model.NewIntVar(0, table[cp], f"blk_{p}_{r}") for r in range(max_rigs)
        ]
        model.Add(sum(a_var[p]) == cp)
        for r in range(max_rigs):
            model.AddElement(a_var[p][r], table, block_var[p][r])
            model.Add(a_var[p][r] >= 1).OnlyEnforceIf(present[p][r])
            model.Add(a_var[p][r] == 0).OnlyEnforceIf(present[p][r].Not())

    used = [model.NewBoolVar(f"used_{r}") for r in range(max_rigs)]
    for r in range(max_rigs):
        distinct = sum(present[p][r] for p in projects)
        model.Add(distinct >= 1).OnlyEnforceIf(used[r])
        model.Add(distinct == 0).OnlyEnforceIf(used[r].Not())
        # load = Σ block + move·(distinct − 1) when used; 0 otherwise.
        load = sum(block_var[p][r] for p in projects) + move * (distinct - used[r])
        model.Add(load <= capacity)
        if r + 1 < max_rigs:  # symmetry: fill low-index rigs first
            model.Add(used[r] >= used[r + 1])

    model.Minimize(sum(used))

    solver = cp_model.CpSolver()
    solver.parameters.num_search_workers = 1  # deterministic
    solver.parameters.max_time_in_seconds = 10.0
    status = solver.Solve(model)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return None

    assignment: dict[str, list[int]] = {}
    n_used = sum(int(solver.Value(u)) for u in used)
    for p in projects:
        assignment[p] = [int(solver.Value(a_var[p][r])) for r in range(n_used)]
    return assignment


def _materialize(
    terrain: str,
    plans: dict[int, RigPlan],
    year: int,
    assignment: dict[str, list[int]],
    a: Assumptions,
    volumes: ProjectVolumes | None = None,
    priority: list[str] | None = None,
) -> None:
    """Lay a year's per-rig assignment onto real dates and append to the shared
    RigPlan objects (keyed by rig index, so a rig accrues wells across years)."""
    maint = _maintenance_days(a)
    # A project's wells for a year can split across rigs (concurrency). Number
    # them with a counter that runs across ALL rigs so the bar labels stay unique
    # — the per-rig index `k` below drives only the batch-gap logic.
    label_seq: dict[str, int] = {}
    for r, plan in plans.items():
        cursor = _year_start(year) + timedelta(days=maint)
        first_project = True
        # Sequencing only: the bin-packing above fixed WHICH wells share a rig
        # (volume-blind, so the rig count is provably priority-independent);
        # the value ordering decides WHO on the rig goes first.
        project_order = sorted(
            assignment,
            key=(
                (lambda p: (*priority_sort_key(p, volumes or {}, priority), p))
                if priority
                else (lambda p: p)
            ),
        )
        for project in project_order:
            count = assignment[project][r] if r < len(assignment[project]) else 0
            if count == 0:
                continue
            move_gap = 0 if first_project else a.project_move_days(terrain)
            if not first_project:
                cursor = cursor + timedelta(days=move_gap)
            first_project = False
            for k in range(1, count + 1):
                start = cursor
                end = start + timedelta(days=a.well_duration_days)
                if k == 1:
                    # First well of a project run: a move gap if a prior project
                    # preceded it this year, otherwise none (year-boundary idle
                    # before the year's first project isn't a rig-move gap).
                    gap_kind, gap_days = (
                        ("project_move", move_gap) if move_gap else ("none", 0)
                    )
                elif (k - 1) % a.batch_size == 0:
                    gap_kind, gap_days = "batch", a.batch_gap_days
                else:
                    gap_kind, gap_days = "inter_well", a.inter_well_gap_days
                label_seq[project] = label_seq.get(project, 0) + 1
                plan.wells.append(
                    ScheduledWell(
                        project=project,
                        year=year,
                        label=f"{project} · {year} · Well {label_seq[project]}",
                        start=start,
                        end=end,
                        gap_before_days=gap_days,
                        gap_kind=gap_kind,
                    )
                )
                if k < count:
                    gap = a.batch_gap_days if k % a.batch_size == 0 else a.inter_well_gap_days
                    cursor = end + timedelta(days=gap)
                else:
                    cursor = end


def _optimize_terrain_milp(
    terrain: str,
    demand: dict[str, dict[int, int]],  # project -> {year: wells}
    a: Assumptions,
    options: Options,
    volumes: ProjectVolumes | None = None,
    priority: list[str] | None = None,
) -> TerrainResult:
    years = sorted({y for by in demand.values() for y in by if by[y]})
    if not years:
        used = list(priority) if priority else None
        return TerrainResult(terrain, True, 0, [], {}, {}, None, [], used)

    move = a.project_move_days(terrain)
    bins_per_year: dict[int, int] = {}
    assignments: dict[int, dict[str, list[int]]] = {}
    infeasible: list[dict] = []
    for y in years:
        counts = {p: demand[p][y] for p in demand if demand[p].get(y, 0) > 0}
        # A year's usable window ends at its completion cutoff (full year when
        # none is set) — every well, gaps included, must fit inside it.
        window = _completion_window_days(y, a.last_completion_month_by_year.get(y))
        capacity = window - _maintenance_days(a)
        packed = _pack_year(counts, capacity, move, a)
        if packed is None:
            for p in counts:
                infeasible.append({"project": p, "year": y})
            continue
        assignments[y] = packed
        bins_per_year[y] = len(next(iter(packed.values()))) if packed else 0

    if infeasible:
        logger.warning(
            "rig optimization (milp) infeasible terrain=%s wells=%d", terrain, len(infeasible)
        )
        used = list(priority) if priority else None
        return TerrainResult(terrain, False, 0, [], {}, {}, None, infeasible, used)

    rig_count = max(bins_per_year.values(), default=0)
    prefix = _RIG_NAME_PREFIX.get(terrain, f"{terrain} Rig")
    plans = {r: RigPlan(name=f"{prefix} {r + 1}") for r in range(rig_count)}
    for y in years:
        _materialize(terrain, plans, y, assignments[y], a, volumes, priority)

    horizon_start = _year_start(years[0])
    horizon_days = (date(years[-1], 12, 31) - horizon_start).days + 1
    utilization = {
        plan.name: round(len(plan.wells) * a.well_duration_days / horizon_days, 3)
        for plan in plans.values()
    }
    active = {y: bins_per_year.get(y, 0) for y in years}

    # The fleet is set by the peak year; name a representative project from it.
    peak_year = max(years, key=lambda y: bins_per_year.get(y, 0))
    peak_counts = {p: demand[p].get(peak_year, 0) for p in demand}
    binding = None
    if rig_count > 0:
        top_project = max(peak_counts, key=lambda p: peak_counts[p])
        binding = {"project": top_project, "year": peak_year}

    return TerrainResult(
        terrain=terrain,
        feasible=True,
        rig_count=rig_count,
        rigs=[plans[r] for r in range(rig_count)],
        rigs_active_per_year=active,
        utilization_per_rig=utilization,
        binding=binding,
        infeasible_wells=[],
        priority_used=list(priority) if priority else None,
    )


def optimize_milp(
    demand_rows: list[dict],
    assumptions: Assumptions,
    options: Options,
    priority_by_terrain: dict[str, list[str]] | None = None,
) -> list[TerrainResult]:
    """Exact per-terrain optimization. Raises SolverUnavailable if OR-Tools is
    missing (caller falls back to the heuristic)."""
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
        _optimize_terrain_milp(
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
