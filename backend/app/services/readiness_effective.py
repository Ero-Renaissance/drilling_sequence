"""Effective readiness values — what a field project or well actually shows.

One rule, used by the team lens API, the rollups' live cells (the dashboard's
tiles), and the revision snapshot's ``readiness_at_submission`` (spec §3.6,
§3.8). Each cell carries two things, and each inherits on its own rule:

- **Applies?** (phase 6) — only checks that DON'T lock with the plan have a tick
  list; a Project gate always applies (a gate that doesn't apply is set to N/A
  instead — decision 31). A field project: its own row, else the CHECK'S
  DEFAULT (``applies_by_default``, phase 7 — False for a check that starts
  unticked, such as the equipment checks). A well: its own choice (checks
  enabled at well level), else its field project's effective choice (checks
  enabled at project level), else the check's default.
- **Status** — a field project shows its own entry, else the status set's
  default. A well: its own entry (checks enabled at well level), else its field
  project's entry — but only while the check APPLIES to the field project — else
  the default. So a well ticked under an unticked field project reads the default
  (On Track), never the project's hidden status.

Unticking keeps the status underneath: ``status`` is reported whatever
``applies`` says, so re-ticking brings it back. A rollup reads ``cell_status``:
the status, or N/A — not counted — for a check that doesn't apply (§3.7).

**Not selected** (phase 7, spec §3.9): a check that starts unticked and reads its
default — no row on the target, nor on its field project — doesn't apply
(``applies_source == "default"``), and carries NOTHING: ``not_selected`` is the
one test, and the team rows' figures, the rollup's live cells and the snapshot's
``readiness_at_submission`` leave such a cell out entirely (not even as N/A). A
check that doesn't apply because of a ROW is "not applicable": N/A, as in phase 6.

Readiness opt-out: an activity with ``readiness_required = False`` carries NO
readiness from any team (decided 2026-10-14) — callers skip it. A project-only
check carries nothing on a well with no field project (``well_has_cell``).
"""
import uuid
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal, Protocol

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.readiness import (
    NA_STATUS,
    STATUS_SETS,
    ReadinessApplicability,
    ReadinessEntry,
)

WellKey = tuple[str, str, str]  # (well_project or "", well_name, activity_type)
# Where a cell's status — or its tick — comes from.
Source = Literal["well", "project", "default"]


class CheckLike(Protocol):
    """What these rules read from a check (a ``ReadinessCheck`` row)."""

    code: str
    status_set: str
    applies_project: bool
    applies_well: bool
    locks_with_plan: bool
    # Phase 7: False = the check starts unticked (spec §3.9).
    applies_by_default: bool


@dataclass
class Effective:
    status: str  # the status underneath — what re-ticking brings back
    source: Source  # where the STATUS comes from
    notes: str | None = None
    updated_at: datetime | None = None
    applies: bool = True  # False: the check doesn't apply here (unticked)
    # Where the TICK comes from; "default" = the check's own default (no row).
    applies_source: Source = "default"


@dataclass
class EntryIndex:
    """A campaign's stored values for some checks: status entries and
    applicability rows, each keyed like the target they belong to."""

    project: dict[tuple[str, str], ReadinessEntry] = field(default_factory=dict)
    well: dict[tuple[str, str, str, str], ReadinessEntry] = field(default_factory=dict)
    project_applies: dict[tuple[str, str], ReadinessApplicability] = field(
        default_factory=dict
    )
    well_applies: dict[tuple[str, str, str, str], ReadinessApplicability] = field(
        default_factory=dict
    )


async def load_index(db: AsyncSession, project_id: uuid.UUID, codes: list[str]) -> EntryIndex:
    """The campaign's entries and applicability rows for ``codes``."""
    if not codes:
        return EntryIndex()
    entries = (
        await db.execute(
            select(ReadinessEntry).where(
                ReadinessEntry.project_id == project_id,
                ReadinessEntry.check_code.in_(codes),
            )
        )
    ).scalars().all()
    rows = (
        await db.execute(
            select(ReadinessApplicability).where(
                ReadinessApplicability.project_id == project_id,
                ReadinessApplicability.check_code.in_(codes),
            )
        )
    ).scalars().all()
    return EntryIndex(
        project={(e.well_project, e.check_code): e for e in entries if e.scope == "project"},
        well={
            (e.well_project, e.well_name, e.activity_type, e.check_code): e
            for e in entries
            if e.scope == "well"
        },
        project_applies={(r.well_project, r.check_code): r for r in rows if r.scope == "project"},
        well_applies={
            (r.well_project, r.well_name, r.activity_type, r.check_code): r
            for r in rows
            if r.scope == "well"
        },
    )


async def load_target_index(
    db: AsyncSession,
    project_id: uuid.UUID,
    codes: list[str],
    *,
    scope: str,
    well_project: str,
    well_name: str = "",
    activity_type: str = "",
) -> EntryIndex:
    """``load_index`` for ONE write's target: the campaign's rows for ``codes``,
    with the target's OWN status entries and applicability rows found by SQL
    equality — the database's comparison, the one its unique keys
    (``uq_readiness_entry``, ``uq_readiness_applicability``) use — and keyed
    under the target's names as given.

    So a write decides update vs insert the way the unique key will judge it: on
    SQL Server's case-insensitive default collation, a write to "BONGA PHASE 3"
    updates the stored "Bonga Phase 3" row instead of inserting a duplicate (a
    500). What the target INHERITS (a well's field project's rows) stays keyed
    by exact names, as every read draws it — so a write's old value is what the
    lens showed. Call it under ``lock_campaign_writes``, so no other write adds a
    row between this read and the write it decides.
    """
    index = await load_index(db, project_id, codes)
    if not codes:
        return index
    names = (well_project, well_name, activity_type)
    if scope == "project":
        maps: tuple[dict, dict] = (index.project, index.project_applies)
    else:
        maps = (index.well, index.well_applies)

    for model, mapping in zip((ReadinessEntry, ReadinessApplicability), maps, strict=True):
        rows = (
            await db.execute(
                select(model).where(
                    model.project_id == project_id,
                    model.check_code.in_(codes),
                    model.scope == scope,
                    model.well_project == well_project,
                    model.well_name == well_name,
                    model.activity_type == activity_type,
                )
            )
        ).scalars().all()
        # The unique key admits one row per target and code; should the
        # comparison ever return two, the exact match wins.
        rows = sorted(rows, key=lambda r: (r.well_project, r.well_name, r.activity_type) == names)
        for row in rows:
            key = (well_project, row.check_code) if scope == "project" else (*names, row.check_code)
            mapping[key] = row
    return index


def _default_status(check: CheckLike) -> str:
    return STATUS_SETS[check.status_set]["default"]


# ── Applies? ────────────────────────────────────────────────────────────────


def default_applies(check: CheckLike) -> bool:
    """What a target with no row of its own — and nothing to follow — reads
    (spec §3.9): the check's ``applies_by_default``. A check that locks with the
    plan always applies: it has no tick list (decision 31), and the catalog
    refuses one that starts unticked. ``None`` (a check not yet flushed) reads
    as the column's default, True — only an explicit False starts unticked."""
    return True if check.locks_with_plan else check.applies_by_default is not False


def project_applies(index: EntryIndex, check: CheckLike, well_project: str) -> tuple[bool, Source]:
    """Whether ``check`` applies to a field project, and where that comes from:
    the project's own row ("project"), else the check's default ("default" —
    ``applies_by_default``, False for a check that starts unticked). A check
    that locks with the plan always applies — the Project gates use N/A, never a
    row (decision 31). A check not enabled at project level, or a target with no
    field project, reads the check's default: no row can speak for them."""
    if check.locks_with_plan or not check.applies_project or not well_project:
        return default_applies(check), "default"
    row = index.project_applies.get((well_project, check.code))
    if row is None:
        return default_applies(check), "default"
    return bool(row.applies), "project"


def well_applies(index: EntryIndex, check: CheckLike, key: WellKey) -> tuple[bool, Source]:
    """Whether ``check`` applies to a well, and where that comes from: the
    well's own choice ("well", checks enabled at well level), else its field
    project's effective choice ("project" for its row, checks enabled at project
    level), else the check's default ("default"). A well's own choice wins even
    where it matches its field project's — it stays until Follow project removes
    it (§3.8)."""
    if check.locks_with_plan:
        return True, "default"
    wp, wn, at = key
    if check.applies_well:
        own = index.well_applies.get((wp, wn, at, check.code))
        if own is not None:
            return bool(own.applies), "well"
    return project_applies(index, check, wp)


# ── Effective cells ─────────────────────────────────────────────────────────


def project_value(index: EntryIndex, check: CheckLike, well_project: str) -> Effective:
    """A field project's cell: its own entry, else the default; and whether the
    check applies to it."""
    applies, applies_source = project_applies(index, check, well_project)
    entry = index.project.get((well_project, check.code)) if well_project else None
    if entry is None:
        return Effective(
            status=_default_status(check),
            source="default",
            applies=applies,
            applies_source=applies_source,
        )
    return Effective(
        status=entry.status,
        source="project",
        notes=entry.notes,
        updated_at=entry.updated_at,
        applies=applies,
        applies_source=applies_source,
    )


def well_value(index: EntryIndex, check: CheckLike, key: WellKey) -> Effective:
    """A well's cell for ``check`` (any scope — a project-only check reads its
    field project's value). Status: the well's own entry, else the field
    project's entry while the check applies to the field project, else the
    default (spec §3.8 table)."""
    wp, wn, at = key
    applies, applies_source = well_applies(index, check, key)
    own = index.well.get((wp, wn, at, check.code)) if check.applies_well else None
    if own is not None:
        return Effective(
            status=own.status,
            source="well",
            notes=own.notes,
            updated_at=own.updated_at,
            applies=applies,
            applies_source=applies_source,
        )
    # Inherited only while the check applies to the field project: re-including a
    # well under an unticked field project must not surface the project's hidden
    # status — the well reads the default instead.
    if check.applies_project and wp and project_applies(index, check, wp)[0]:
        entry = index.project.get((wp, check.code))
        if entry is not None:
            return Effective(
                status=entry.status,
                source="project",
                notes=entry.notes,
                updated_at=entry.updated_at,
                applies=applies,
                applies_source=applies_source,
            )
    return Effective(
        status=_default_status(check),
        source="default",
        applies=applies,
        applies_source=applies_source,
    )


def well_has_cell(check: CheckLike, well_project: str) -> bool:
    """Whether a well target (one with a well name) carries a cell for
    ``check`` (spec §3.7 "What counts", §7.12): a check enabled at well level
    always does; a project-only check only under a field project — on a well with
    no field project it carries nothing, not even its default."""
    return bool(check.applies_well or (check.applies_project and well_project))


def well_cells(
    index: EntryIndex, checks: Iterable[CheckLike], key: WellKey
) -> dict[str, Effective]:
    """Every cell one well carries, in the order of ``checks``, each at its
    effective value (``well_has_cell`` decides which)."""
    return {c.code: well_value(index, c, key) for c in checks if well_has_cell(c, key[0])}


def not_selected(value: Effective) -> bool:
    """A cell that is NOT SELECTED (phase 7, spec §3.7, §3.9): the check doesn't
    apply, and that comes from the check's own default — a check that starts
    unticked with no row on the target or on its field project. It carries
    nothing: callers leave it out of every figure (not even counted as N/A) and
    out of snapshots. A check that doesn't apply because of a row (``well`` or
    ``project``) is "not applicable" instead, and reads N/A (``cell_status``).

    The one test, for its three callers: the team rows' ``figures``, both
    branches of the rollup's live cells, and the snapshot's
    ``readiness_at_submission``."""
    return not value.applies and value.applies_source == "default"


def cell_status(value: Effective) -> str:
    """The status a ROLLUP reads for a cell (spec §3.7): its effective status, or
    N/A — not counted — when the check doesn't apply, whatever sits underneath.
    Snapshots record it the same way (§6). A cell that is ``not_selected`` is
    left out before this is read."""
    return value.status if value.applies else NA_STATUS
