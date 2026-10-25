"""Readiness rollups — the ONE definition every figure uses (spec §3.7).

Readiness measures what is DONE. Every tile, KPI and percentage goes through this
module, never a local formula:

- A *cell* is one check for one *target* (a field project, or a well = field
  project + well + activity type). Its value is the effective status (§3.6); an
  unset cell reads its status set's default, and every default is on track.
- Cells roll up by their shared severity, never by status text: N/A is not
  counted, and neither is a team check that doesn't apply (unticked, §3.8 — the
  live cells read it as N/A). A check that is NOT SELECTED (phase 7, §3.9: it
  starts unticked and no row ticks it) carries nothing — no cell at all, not
  even a not-counted one; **Complete** = done ÷ counted (the headline);
  **On track** = (done + in progress) ÷ counted; **Behind** = blocked cells.
- A target is *ready* when it has ≥1 counted cell and every counted cell is done.
  A target where nothing counts ("Nothing applies") is left out of the ready
  count.
- Each target counts once, however many activities share it. Opted-out and
  completed activities carry nothing; project-level checks need a field project,
  well-level checks a well name, and a project-only check carries nothing on a
  well with no field project.
- Tiles count FIELD PROJECTS for every team with project-level checks (2026-10-25,
  as the Project gates always have); a team whose checks are all well-level has
  no field-project view, so its tile counts wells, as its grid does. For a check
  enabled at well level, a field project reads the
  WORST of its in-scope wells — each well's effective value, its project's
  unless it has its own — so the check is done for the field project only when
  it is done for every well that needs it, and behind when any of them is
  behind. A project-only check, or a field project with no well in scope, reads
  the project's own value (``fold_project_cells``). A well with no field project
  has no field-project target. The Project gates have no well level.
- Nothing counted → ``None`` (shown "—", never 0%). Percentages round half up.
"""
import uuid
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date
from typing import Literal, Protocol

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.readiness import STATUS_SETS, ReadinessCheck
from app.services.readiness_effective import (
    cell_status,
    load_index,
    not_selected,
    project_value,
    well_cells,
)

# Status → shared severity. Status names are unique across the status sets, so a
# status alone fixes its severity — which lets frozen snapshots (status text only)
# roll up without their status sets.
SEVERITY_OF: dict[str, str] = {
    status: severity
    for spec in STATUS_SETS.values()
    for status, severity in spec["statuses"].items()
}

# GateBreakdown bucket per severity (the "by gate" card speaks standard statuses).
BUCKET_OF_SEVERITY = {
    "done": "completed",
    "in_progress": "on_track",
    "blocked": "behind",
    "not_counted": "na",
}

# What a governed gate missing from a frozen snapshot block reads as: the standard
# default (governed gates are the Projects team's, all `standard`).
SNAPSHOT_GATE_DEFAULT = STATUS_SETS["standard"]["default"]


def severity_of(status: str) -> str:
    """The shared severity of a status; an unknown one (a retired legacy status
    in an old snapshot) counts as in progress — counted, not done."""
    return SEVERITY_OF.get(status, "in_progress")


def pct(part: int, whole: int) -> int | None:
    """``part / whole`` as a whole-number percentage, rounded HALF UP so the
    backend agrees with the browser's Math.round (Python's round() is banker's:
    12.5 → 12). None when nothing counts."""
    if whole <= 0:
        return None
    return (200 * part + whole) // (2 * whole)


@dataclass(frozen=True)
class Figures:
    """The rollup of a set of targets."""

    targets: int = 0  # targets in scope
    counted: int = 0  # cells that count (not N/A, and the check applies)
    done: int = 0
    in_progress: int = 0
    behind: int = 0  # blocked cells
    na: int = 0  # not-counted cells (N/A, or a team check that doesn't apply)
    ready: int = 0  # targets with ≥1 counted cell, every counted cell done
    ready_of: int = 0  # targets with ≥1 counted cell
    by_check: dict[str, dict[str, int]] = field(default_factory=dict)

    @property
    def complete_pct(self) -> int | None:
        """The headline: done ÷ counted."""
        return pct(self.done, self.counted)

    @property
    def on_track_pct(self) -> int | None:
        """Completed or on track — nothing behind: (done + in progress) ÷ counted."""
        return pct(self.done + self.in_progress, self.counted)


def target_figures(statuses: Iterable[str]) -> Figures:
    """ONE target (a field project or a well) from its cells' effective statuses."""
    severities = [severity_of(s) for s in statuses]
    counted = [s for s in severities if s != "not_counted"]
    return Figures(
        targets=1,
        counted=len(counted),
        done=counted.count("done"),
        in_progress=counted.count("in_progress"),
        behind=counted.count("blocked"),
        na=len(severities) - len(counted),
        ready=1 if counted and all(s == "done" for s in counted) else 0,
        ready_of=1 if counted else 0,
    )


def rollup(targets: Iterable[Mapping[str, str]], codes: Sequence[str] = ()) -> Figures:
    """Roll up targets, each a ``{check_code: effective status}`` cell map — the
    sum of each target's ``target_figures``.

    ``codes`` (optional) names the checks to break down per check — the "by gate"
    card — in display order."""
    totals = dict.fromkeys(
        ("targets", "counted", "done", "in_progress", "behind", "na", "ready", "ready_of"), 0
    )
    by_check = {c: {"completed": 0, "on_track": 0, "behind": 0, "na": 0} for c in codes}
    for cells in targets:
        one = target_figures(cells.values())
        for name in totals:
            totals[name] += getattr(one, name)
        for code, buckets in by_check.items():
            if code in cells:
                buckets[BUCKET_OF_SEVERITY[severity_of(cells[code])]] += 1
    return Figures(**totals, by_check=by_check)


def target_ready(cells: Mapping[str, str]) -> bool:
    """One target's readiness: ≥1 counted cell and every counted cell done."""
    return target_figures(cells.values()).ready == 1


# ── Scope: which activities carry readiness ─────────────────────────────────
# The one rule (spec §3.7) every endpoint and figure uses — the dashboard's focus
# window, the Readiness tab's `focus_start` / `focus_in_days`, the team lens.


class ActivityLike(Protocol):
    start_date: date
    completed_at: object
    readiness_required: bool


def carries_readiness(activity: ActivityLike) -> bool:
    """Readiness-required and not completed — work left to be ready for."""
    return bool(activity.readiness_required) and activity.completed_at is None


# Window presets (months → days) — the Overview's readiness window (its
# activity-type mix too) and every Readiness lens's; 0 = no window (frontend
# lib/readiness-window.ts mirrors it; a test pins both).
HORIZON_DAYS: dict[int, int] = {6: 183, 12: 365, 24: 730}


def in_scope(activity: ActivityLike, window_end: date | None) -> bool:
    """An activity that puts its target in scope for a window: it carries
    readiness and starts on/before the window's end (None = no date limit)."""
    return carries_readiness(activity) and (
        window_end is None or activity.start_date <= window_end
    )


def focus_start_of(activities: Iterable[ActivityLike]) -> date | None:
    """A target's focus start: the earliest start among its activities that carry
    readiness. None = nothing left to be ready for (completed or opted out), so
    the target is in no window. In a window of N days iff focus start ≤ today + N."""
    return min((a.start_date for a in activities if carries_readiness(a)), default=None)


def days_until(day: date | None, today: date) -> int | None:
    """Days from the SERVER's today to ``day`` — sent with each row so the browser
    windows rows on the server's calendar, exactly as the Overview tile does."""
    return None if day is None else (day - today).days


# ── A field project's cells (2026-10-25) ────────────────────────────────────

# Which status of a check's cells under one field project wins: blocked over in
# progress over done; not counted (N/A) only when nothing counts.
_SEVERITY_RANK = {"not_counted": 0, "done": 1, "in_progress": 2, "blocked": 3}


def worst_status(statuses: Iterable[str]) -> str:
    """The worst of one check's cells by shared severity (never status text)."""
    return max(statuses, key=lambda s: _SEVERITY_RANK[severity_of(s)])


def fold_project_cells(
    codes: Sequence[str],
    own: Mapping[str, str],
    wells: Iterable[Mapping[str, str]],
    well_level: Iterable[str],
) -> dict[str, str]:
    """ONE field project's cells (spec §3.7), each check once:

    - a check enabled at well level (``well_level``) reads the worst of its
      wells' cells — each well's effective value, which is the project's own
      wherever the well follows it — so it is done for the field project only
      when it is done for every well that needs it, behind when any is behind,
      and N/A (not counted) only when it applies to none of them;
    - a project-only check — or any check, when no well is in scope — reads the
      project's own cell.

    A check with no cell (not selected) has none here either. ``own`` and
    ``wells`` hold statuses, not-selected checks left out; the result is in
    ``codes`` (catalog) order."""
    wells = list(wells)
    by_well = set(well_level)
    out: dict[str, str] = {}
    for code in codes:
        if code in by_well and wells:
            statuses = [cells[code] for cells in wells if code in cells]
        else:
            statuses = [own[code]] if code in own else []
        if statuses:
            out[code] = worst_status(statuses)
    return out


def project_own_statuses(
    index: Mapping, checks: Sequence[ReadinessCheck], well_project: str
) -> dict[str, str]:
    """A field project's own cells: its project-level checks' effective statuses
    (N/A where the check doesn't apply), not-selected checks left out."""
    out: dict[str, str] = {}
    for c in checks:
        if c.applies_project:
            value = project_value(index, c, well_project)
            if not not_selected(value):
                out[c.code] = cell_status(value)
    return out


def well_level_statuses(
    index: Mapping, checks: Sequence[ReadinessCheck], key: tuple[str, str, str]
) -> dict[str, str]:
    """A well's cells for the checks enabled at WELL level — inheritance included
    (§3.6/§3.8). A project-only check is its field project's own cell, not each
    well's, so it isn't here."""
    well_level = [c for c in checks if c.applies_well]
    return {
        code: cell_status(value)
        for code, value in well_cells(index, well_level, key).items()
        if not not_selected(value)
    }


# ── Live plan ───────────────────────────────────────────────────────────────


async def live_cells(
    db: AsyncSession,
    project_id: uuid.UUID,
    checks: Sequence[ReadinessCheck],
    activities: Iterable[Activity],
    *,
    unit: Literal["projects", "wells"] | None = None,
) -> tuple[str, dict[tuple[str, ...], dict[str, str]]]:
    """One team's targets among ``activities`` (already narrowed by ``in_scope``)
    with every check's effective status — N/A for a check that doesn't apply to
    the target (``cell_status``), so it isn't counted. A check that is NOT
    SELECTED for the target (``not_selected``, phase 7) has no cell at all: it is
    left out of every figure, not even counted as N/A. A target left with no
    cell still counts as a target, where nothing applies.

    Returns ``(unit, {target key: cells})``. A team with project-level checks —
    the Project gates, Logistics… — counts FIELD PROJECTS, keyed (field
    project,), each folding in its wells among ``activities`` (the window),
    ``fold_project_cells``; the Project gates have no well level, so they read
    their own values. A team whose checks are all well-level (or ``unit=
    "wells"``) counts WELLS, keyed (field project or "", well, activity type),
    project-level values and ticks reaching them by inheritance — that team's
    grid has no Projects view to match a field-project count. An activity
    without a well name has no well target; one without a field project has no
    field-project target, and its well carries no project-only check."""
    activities = list(activities)
    index = await load_index(db, project_id, [c.code for c in checks])
    if unit is None:
        unit = "projects" if any(c.applies_project for c in checks) else "wells"
    if unit == "wells":
        wells = sorted(
            {
                (a.well_project or "", a.well_name, a.activity_type)
                for a in activities
                if a.well_name
            }
        )
        return "wells", {
            key: {
                code: cell_status(v)
                for code, v in well_cells(index, checks, key).items()
                if not not_selected(v)
            }
            for key in wells
        }
    projects = sorted({a.well_project for a in activities if a.well_project})
    wells_of: dict[str, set[tuple[str, str, str]]] = {}
    if any(c.applies_well for c in checks):
        for a in activities:
            if a.well_project and a.well_name:
                wells_of.setdefault(a.well_project, set()).add(
                    (a.well_project, a.well_name, a.activity_type)
                )
    codes = [c.code for c in checks]
    well_level = [c.code for c in checks if c.applies_well]
    return "projects", {
        (wp,): fold_project_cells(
            codes,
            project_own_statuses(index, checks, wp),
            [well_level_statuses(index, checks, key) for key in sorted(wells_of.get(wp, ()))],
            well_level,
        )
        for wp in projects
    }


# ── Frozen snapshots ────────────────────────────────────────────────────────


def per_activity_readiness(snapshot: Sequence[Mapping]) -> bool:
    """Whether a frozen snapshot carries PER-ACTIVITY gates (revisions from before
    readiness became per field project on 2026-07-16 — migration 029 kept their
    blocks) rather than per-field-project ones.

    No format marker was ever stored, and ``well_project`` doesn't tell them apart
    (it predates the change). So read the invariant every per-field-project
    snapshot satisfies by construction: each field project's gates are ONE copy
    repeated on all its activities, and an activity with no field project carries
    only defaults (or, from phase 5, nothing). A snapshot that breaks it — or has
    no ``well_project`` at all — recorded its gates per activity."""
    blocks: dict[str, dict] = {}
    for a in snapshot:
        if "well_project" not in a:
            return True
        readiness = dict(a.get("readiness") or {})
        if a["well_project"]:
            if blocks.setdefault(a["well_project"], readiness) != readiness:
                return True
        elif any(status != SNAPSHOT_GATE_DEFAULT for status in readiness.values()):
            return True
    return False


def snapshot_gate_targets(
    snapshot: Iterable[Mapping],
    gate_codes: Sequence[str] | None = None,
    window_end: date | None = None,
) -> list[dict[str, str]]:
    """The governed gates of a frozen snapshot, one cell map per TARGET in scope
    (readiness-required, not completed, starting by ``window_end`` — None = no
    date limit). ``gate_codes`` are the revision's frozen gates (a gate missing
    from a block reads On Track); None = whatever each block holds.

    Per-field-project snapshots denormalise each field project's gates onto every
    activity under it: the target is the FIELD PROJECT (the first activity in
    scope speaks for it), and an activity with no field project carries no gates.
    Per-activity snapshots (``per_activity_readiness``) recorded gates per
    ACTIVITY: each activity is its own target, as they were aggregated then."""
    snapshot = list(snapshot)
    per_activity = per_activity_readiness(snapshot)
    by_target: dict[object, Mapping[str, str]] = {}
    for i, a in enumerate(snapshot):
        if a.get("completed_at") or not a.get("readiness_required", True):
            continue
        start = _snap_date(a.get("start_date"))
        if start is None or (window_end is not None and start > window_end):
            continue
        if per_activity:
            key: object = ("activity", i)
        elif a.get("well_project"):
            key = a["well_project"]
        else:
            continue  # no field project → no project gates (§3.7)
        by_target.setdefault(key, a.get("readiness") or {})
    if gate_codes is None:
        return [dict(readiness) for readiness in by_target.values()]
    return [
        {c: readiness.get(c, SNAPSHOT_GATE_DEFAULT) for c in gate_codes}
        for readiness in by_target.values()
    ]


def _snap_date(value: object) -> date | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None
