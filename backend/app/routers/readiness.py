import logging
import uuid
from collections.abc import Iterable
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.locks import assert_project_not_locked, lock_campaign_writes
from app.core.rbac import assert_can_edit_check
from app.database import get_db
from app.models.activity import Activity
from app.models.readiness import (
    PROJECTS_TEAM,
    ReadinessApplicability,
    ReadinessCheck,
    ReadinessEntry,
    ReadinessTeam,
    is_withdrawn,
    pickable_statuses,
)
from app.models.user import User
from app.schemas.readiness import (
    ApplicabilityResult,
    ApplicabilityUpdate,
    CatalogCheck,
    CatalogTeam,
    CheckState,
    CheckUpsert,
    CheckUpsertResponse,
    EffectiveCheckState,
    ReadinessCatalog,
    RowFigures,
    TeamCheckState,
    TeamProjectRow,
    TeamReadiness,
    TeamWellRow,
    WellTarget,
    status_sets_payload,
)
from app.schemas.readiness import ProjectReadiness as ProjectReadinessSchema
from app.services.audit import ENTITY_READINESS, governance_event
from app.services.readiness_catalog import (
    active_checks,
    active_teams,
    default_status,
    is_valid_status,
    project_gate_checks,
)
from app.services.readiness_effective import (
    Effective,
    EntryIndex,
    WellKey,
    cell_status,
    default_applies,
    load_index,
    load_target_index,
    not_selected,
    project_applies,
    project_value,
    well_applies,
    well_cells,
    well_value,
)
from app.services.readiness_rollup import days_until, focus_start_of, target_figures

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/projects/{project_id}", tags=["readiness"])
# Campaign-independent catalog reads. Separate router: a different prefix.
catalog_router = APIRouter(prefix="/api/readiness", tags=["readiness"])

CurrentUser = Annotated[User, Depends(get_current_user)]
DB = Annotated[AsyncSession, Depends(get_db)]

# The 409 for a status write — or Reset to project — on a team check that doesn't
# apply to the target (spec §5.1, §7.10): tick it first. A check that is not
# selected (phase 7: it starts unticked and nothing ticks it) doesn't apply either.
_NOT_APPLICABLE_DETAIL = "This check doesn't apply here — tick it first"
# The Project gates have no tick list (decision 31): a gate that doesn't apply is
# set to N/A in its status menu instead.
_GATES_USE_NA_DETAIL = "The Project gates use N/A"
# The 409 when a write's insert still hits a readiness unique key (the backstop
# behind ``_target_index``): generic — no names, ids or SQL reach the client.
_CONFLICT_DETAIL = "This readiness value changed while saving — reload and try again"


def _row_figures(statuses: Iterable[str]) -> RowFigures:
    """One row (one target) through the rollup of spec §3.7."""
    f = target_figures(statuses)
    return RowFigures(
        counted=f.counted,
        done=f.done,
        in_progress=f.in_progress,
        behind=f.behind,
        na=f.na,
        ready=f.ready == 1,
    )


async def _campaign_locked(project_id: uuid.UUID, db: AsyncSession) -> bool:
    """True while any activity in the campaign is locked by a revision, pending
    or approved — the Project gates are part of the snapshot under approval (and
    of the approved record), so they freeze with the plan."""
    result = await db.execute(
        select(Activity.id)
        .where(
            Activity.project_id == project_id,
            Activity.locked_by_revision_id.is_not(None),
        )
        .limit(1)
    )
    return result.scalar_one_or_none() is not None


@catalog_router.get("/catalog", response_model=ReadinessCatalog)
async def get_catalog(current_user: CurrentUser, db: DB) -> ReadinessCatalog:
    """Active teams and checks (withdrawn checks are never active), plus the
    code-defined status sets with their shared severities. Read by every
    authenticated user (reads are org-wide): the frontend renders columns, icons
    and legends from it."""
    teams = await active_teams(db)
    team_codes = {t.code for t in teams}
    checks = [c for c in await active_checks(db) if c.team_code in team_codes]
    return ReadinessCatalog(
        teams=[CatalogTeam.model_validate(t) for t in teams],
        checks=[CatalogCheck.model_validate(c) for c in checks],
        status_sets=status_sets_payload(),
    )


@router.get("/readiness", response_model=list[ProjectReadinessSchema])
async def list_readiness(
    project_id: uuid.UUID, current_user: CurrentUser, db: DB
) -> list[ProjectReadinessSchema]:
    """Readiness per FIELD-DEVELOPMENT PROJECT (the "Project" column). One entry
    per distinct ``well_project`` in the campaign, each with the catalog's active
    project gates. Activities with no project have no gates and are omitted.
    The Project gates have no tick list (decision 31): a gate that doesn't apply
    reads N/A, so this shape is unchanged by phase 6.
    """
    # Reads are org-wide: any authenticated user may view campaign data.
    # The campaign's activities per field project (exact names, as readiness
    # entries and the Overview tile key them), in the database's name order.
    activity_rows = (
        await db.execute(
            select(
                Activity.well_project,
                Activity.start_date,
                Activity.completed_at,
                Activity.readiness_required,
            )
            .where(Activity.project_id == project_id, Activity.well_project.is_not(None))
            .order_by(Activity.well_project)
        )
    ).all()
    by_project: dict[str, list] = {}
    for a in activity_rows:
        if a.well_project:
            by_project.setdefault(a.well_project, []).append(a)
    if not by_project:
        return []

    checks = await project_gate_checks(db)
    gates_result = await db.execute(
        select(ReadinessEntry).where(
            ReadinessEntry.project_id == project_id,
            ReadinessEntry.scope == "project",
        )
    )
    by_gate: dict[tuple[str, str], ReadinessEntry] = {
        (g.well_project, g.check_code): g for g in gates_result.scalars().all()
    }
    locked = await _campaign_locked(project_id, db)
    today = date.today()

    def _state(well_project: str, check: ReadinessCheck) -> CheckState:
        gate = by_gate.get((well_project, check.code))
        if gate is not None:
            return CheckState(status=gate.status, notes=gate.notes, updated_at=gate.updated_at)
        return CheckState(status=default_status(check.status_set), notes=None, updated_at=None)

    rows = []
    for wp, acts in by_project.items():
        states = {c.code: _state(wp, c) for c in checks}
        # The window signal (spec §3.7): the same scope rule as the Overview tile.
        focus = focus_start_of(acts)
        rows.append(
            ProjectReadinessSchema(
                well_project=wp,
                checks=states,
                activity_count=len(acts),
                locked=locked,
                focus_start=focus,
                focus_in_days=days_until(focus, today),
                figures=_row_figures(s.status for s in states.values()),
            )
        )
    return rows


# ── Writes: shared helpers ──────────────────────────────────────────────────


def _well_project_filter(well_project: str):  # type: ignore[no-untyped-def]
    """Activities of a field project; "" matches wells with no field project."""
    if well_project:
        return Activity.well_project == well_project
    return or_(Activity.well_project.is_(None), Activity.well_project == "")


def _target_filters(target: WellTarget) -> list:
    """The campaign activities a target names: a field project's, or one well's
    (field project + well + activity type)."""
    filters = [_well_project_filter(target.well_project)]
    if target.scope == "well":
        filters += [
            Activity.well_name == target.well_name,
            Activity.activity_type == target.activity_type,
        ]
    return filters


def _well_key(target: WellTarget) -> WellKey:
    return (target.well_project, target.well_name or "", target.activity_type or "")


async def _resolve_check(check_code: str, db: AsyncSession) -> tuple[ReadinessCheck, str]:
    """The ACTIVE catalog check (of an active team) and its team's editor source.
    The catalog is public (GET /api/readiness/catalog), so resolving it before
    authorization — its team decides who may write — leaks nothing. A withdrawn
    check (NEQ, spec §4.4) is treated as retired."""
    row = (
        await db.execute(
            select(ReadinessCheck, ReadinessTeam.editor_source)
            .join(ReadinessTeam, ReadinessTeam.code == ReadinessCheck.team_code)
            .where(
                ReadinessCheck.code == check_code,
                ReadinessCheck.retired_at.is_(None),
                # Bare boolean column compiles to "= 1" on SQL Server;
                # .is_(True) would render "IS 1", a syntax error there.
                ReadinessTeam.is_active,
            )
        )
    ).one_or_none()
    if row is None or is_withdrawn(row[0]):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Unknown or retired readiness check",
        )
    return row[0], row[1]


async def _resolve_team(team_code: str, db: AsyncSession) -> ReadinessTeam:
    """The ACTIVE team, else 404. Public catalog data — leaks nothing."""
    team = (
        await db.execute(
            # Bare boolean column: "= 1" on SQL Server (.is_(True) → "IS 1").
            select(ReadinessTeam).where(ReadinessTeam.code == team_code, ReadinessTeam.is_active)
        )
    ).scalar_one_or_none()
    if team is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")
    return team


def _assert_enabled_at(check: ReadinessCheck, scope: str) -> None:
    """The check must be enabled at the target's level (spec §3.8 "Words")."""
    enabled = check.applies_project if scope == "project" else check.applies_well
    if not enabled:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="This readiness check isn't used at that level",
        )


def _assert_pickable(check: ReadinessCheck, status_value: str) -> None:
    """A status a person may pick for this check (spec §3.3): one of its set's,
    and never N/A for a check that doesn't lock with the plan — those teams untick
    a check that doesn't apply (§3.8). The Project gates still take N/A."""
    if not is_valid_status(check.status_set, status_value):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid status for this readiness check",
        )
    if status_value not in pickable_statuses(check):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Untick the check instead",
        )


async def _assert_target_exists(
    project_id: uuid.UUID, target: WellTarget, db: AsyncSession
) -> None:
    """BOLA: the field project / well must exist in THIS campaign — no inventing
    readiness for names with no activities here."""
    stmt = select(Activity.id).where(Activity.project_id == project_id, *_target_filters(target))
    if (await db.execute(stmt.limit(1))).scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No matching activities in this campaign",
        )


async def _target_index(
    db: AsyncSession, project_id: uuid.UUID, codes: list[str], target: WellTarget
) -> EntryIndex:
    """The stored rows a write to ``target`` decides on (``load_target_index``):
    its OWN rows found by the database's comparison, so update-vs-insert matches
    the unique keys on any collation; what it inherits as the reads draw it.
    Call it under ``lock_campaign_writes``."""
    return await load_target_index(
        db,
        project_id,
        codes,
        scope=target.scope,
        well_project=target.well_project,
        well_name=target.well_name or "",
        activity_type=target.activity_type or "",
    )


async def _flush_or_409(
    db: AsyncSession, project_id: uuid.UUID, user: User, codes: Iterable[str]
) -> None:
    """Flush a readiness write; if an insert still hits a unique key (a stored
    row the lookup didn't find), roll back and answer 409 — never a 500. Logs
    ids and check codes only."""
    # Read before the rollback, which expires every loaded object (``user``
    # included — reading it after would be lazy IO outside the async context).
    actor_id = user.id
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        logger.warning(
            "readiness write conflict actor_id=%s project_id=%s checks=%s",
            actor_id,
            project_id,
            ",".join(codes),
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=_CONFLICT_DETAIL
        ) from None


def _shown(index: EntryIndex, check: ReadinessCheck, target: WellTarget) -> Effective:
    """What the target shows for ``check`` right now — its own entry, else (a
    well) the field project's while the check applies there, else the default —
    and whether the check applies to it (spec §3.8). The status PUT's audit old
    value and no-change check read it, so saving the value already shown is not
    a change, and a well ticked under an unticked field project audits the
    default, never the project's hidden status."""
    if target.scope == "project":
        return project_value(index, check, target.well_project)
    return well_value(index, check, _well_key(target))


def _own_entry(
    index: EntryIndex, check: ReadinessCheck, target: WellTarget
) -> ReadinessEntry | None:
    """The target's OWN stored entry for ``check`` (never an inherited one)."""
    if target.scope == "project":
        return index.project.get((target.well_project, check.code))
    return index.well.get((*_well_key(target), check.code))


def _target_label(target: WellTarget) -> str:
    """Audit wording for a target. ASCII only: audit columns may be VARCHAR on
    SQL Server."""
    if target.scope == "project":
        return target.well_project
    project = target.well_project or "no field project"
    return f"{target.well_name} ({project}, {target.activity_type})"


# ── Team rows (the lens read, and the applicability write's response) ───────


def _counted_statuses(values: Iterable[Effective]) -> list[str]:
    """What a row's ``figures`` roll up (spec §3.7): each cell's ``cell_status``
    (N/A where the check doesn't apply because of a row), with the cells that
    are NOT SELECTED left out entirely — the same cells the rollup's live cells
    leave out, so the tab adds up to the tile."""
    return [cell_status(v) for v in values if not not_selected(v)]


def _team_cell(value: Effective) -> TeamCheckState:
    return TeamCheckState(
        status=value.status,
        notes=value.notes,
        updated_at=value.updated_at,
        applies=value.applies,
        applies_source=value.applies_source,
    )


def _well_cell(value: Effective) -> EffectiveCheckState:
    return EffectiveCheckState(
        status=value.status,
        notes=value.notes,
        updated_at=value.updated_at,
        applies=value.applies,
        applies_source=value.applies_source,
        source=value.source,
    )


async def _team_rows(
    project_id: uuid.UUID,
    checks: list[ReadinessCheck],
    db: AsyncSession,
    target: WellTarget | None = None,
) -> tuple[list[TeamProjectRow], list[TeamWellRow]]:
    """One team's rows in a campaign — every row, or (``target``) only the rows
    one write affects: a field project's row plus every well row under it (they
    follow it), or one well's row. ONE builder for both, so the applicability
    write returns rows exactly as the lens read draws them.

    Each cell is the effective value of spec §3.6/§3.8 with whether the check
    applies; a row's ``figures`` don't count a cell that doesn't apply. A cell
    that is NOT SELECTED (phase 7, §3.9 — a check that starts unticked, with no
    row ticking it here) is still returned, for the tick list, but left out of
    ``figures`` entirely: not even counted as N/A (``_counted_statuses``).
    """
    index = await load_index(db, project_id, [c.code for c in checks])
    stmt = select(
        Activity.well_project,
        Activity.well_name,
        Activity.activity_type,
        Activity.location,
        Activity.start_date,
        Activity.completed_at,
        Activity.readiness_required,
    ).where(Activity.project_id == project_id)
    if target is not None:
        stmt = stmt.where(*_target_filters(target))
    activities = (await db.execute(stmt)).all()

    today = date.today()
    project_checks = [c for c in checks if c.applies_project]
    project_rows: list[TeamProjectRow] = []
    if project_checks and (target is None or target.scope == "project"):
        by_project: dict[str, list] = {}
        for a in activities:
            if a.well_project:
                by_project.setdefault(a.well_project, []).append(a)
        for wp, acts in sorted(by_project.items()):
            values = {c.code: project_value(index, c, wp) for c in project_checks}
            # The window signal — the same scope rule as the tiles (spec §3.7).
            focus = focus_start_of(acts)
            project_rows.append(
                TeamProjectRow(
                    well_project=wp,
                    activity_count=len(acts),
                    checks={code: _team_cell(v) for code, v in values.items()},
                    focus_start=focus,
                    focus_in_days=days_until(focus, today),
                    figures=_row_figures(_counted_statuses(values.values())),
                )
            )

    well_rows: list[TeamWellRow] = []
    if any(c.applies_well for c in checks):
        groups: dict[WellKey, list] = {}
        for a in activities:
            # No well name → no well gates; readiness opt-out → no readiness at all
            # (from any team — decided 2026-10-14).
            if a.well_name and a.readiness_required:
                key = (a.well_project or "", a.well_name, a.activity_type)
                groups.setdefault(key, []).append(a)

        for key, acts in groups.items():
            acts.sort(key=lambda a: a.start_date)
            focus = focus_start_of(acts)
            # A project-only check carries nothing on a well with no field project
            # (spec §3.7, §7.12) — it is absent from the row, not drawn at its default.
            values = well_cells(index, checks, key)
            well_rows.append(
                TeamWellRow(
                    well_project=key[0],
                    well_name=key[1],
                    activity_type=key[2],
                    activity_count=len(acts),
                    location=acts[0].location,
                    start_date=acts[0].start_date,
                    focus_start=focus,
                    focus_in_days=days_until(focus, today),
                    checks={code: _well_cell(v) for code, v in values.items()},
                    figures=_row_figures(_counted_statuses(values.values())),
                )
            )
        well_rows.sort(key=lambda r: (r.start_date, r.well_project, r.well_name, r.activity_type))
    return project_rows, well_rows


# ── Writes ──────────────────────────────────────────────────────────────────
# Every readiness write runs in the same order (spec §5.2, phase 6): body
# validation (Pydantic, 422) → resolve the check or team (catalog, public) →
# assert_can_edit_check → lock_campaign_writes → the remaining validation and
# BOLA → the plan lock for checks that lock with the plan (423) → writes, audit,
# one commit. The campaign write lock comes before anything the write decides on
# is read, so a Project-gate write can't commit between a submit's snapshot and
# its plan lock, and two first writes to one target can't collide on the unique
# key.


@router.put(
    # No user text in the URL path: names are free-form and can carry "/"
    # ("Gbaran 31/30") or "+" ("Egbema Node FOD + IOGD"), and IIS request
    # filtering rejects '+'/'%2B' in a path (404.11) before the request reaches
    # uvicorn (ticket DS-001). They travel in the JSON body; the path carries only
    # ``check_code``, validated against the catalog.
    "/readiness/{check_code}",
    response_model=CheckUpsertResponse,
)
async def upsert_readiness_check(
    project_id: uuid.UUID,
    check_code: str,
    payload: CheckUpsert,
    current_user: CurrentUser,
    db: DB,
) -> CheckUpsertResponse:
    """Set one check's status for a field project (shared by every activity under
    it) or for one well (``scope="well"``: project + well + activity type). Who may
    write depends on the check's team (``assert_can_edit_check``): planners for
    the project gates, team-grant holders for Wells/Logistics…, admins for all.

    A team check (one that doesn't lock with the plan) never takes N/A — it is
    unticked instead (422) — and takes no status where it doesn't apply (409):
    tick it first (spec §3.8, §7.10). That includes a check that is not selected
    there (phase 7, §3.9): equipment is nominated before its status is set."""
    check, editor_source = await _resolve_check(check_code, db)
    await assert_can_edit_check(
        project_id,
        team_code=check.team_code,
        editor_source=editor_source,
        user=current_user,
        db=db,
    )
    await lock_campaign_writes(project_id, db)
    _assert_enabled_at(check, payload.scope)
    _assert_pickable(check, payload.status)
    await _assert_target_exists(project_id, payload, db)

    # The target's own stored row, by the database's comparison — so a case
    # variant of a stored name updates that row instead of inserting a duplicate.
    index = await _target_index(db, project_id, [check.code], payload)
    # What the user saw before this write — its own entry, else (a well) the
    # inherited project value while the check applies there, else the default.
    shown = _shown(index, check, payload)
    if not shown.applies:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=_NOT_APPLICABLE_DETAIL)

    # Governed checks are part of the snapshot under approval (and of the approved
    # record) — they freeze with the plan. Operational checks (well, logistics…)
    # stay editable.
    if check.locks_with_plan:
        await assert_project_not_locked(project_id, db)

    gate = _own_entry(index, check, payload)
    if gate is None:
        gate = ReadinessEntry(
            project_id=project_id,
            check_code=check.code,
            scope=payload.scope,
            well_project=payload.well_project,
            well_name=payload.well_name or "",
            activity_type=payload.activity_type or "",
            status=payload.status,
            notes=payload.notes,
            updated_by=current_user.id,
        )
        db.add(gate)
    else:
        gate.status = payload.status
        gate.notes = payload.notes
        gate.updated_by = current_user.id
    await _flush_or_409(db, project_id, current_user, [check.code])  # assigns gate.id

    # Every real change is audited — `updated_by` only remembers the LAST editor,
    # and team grants span every campaign, so the full history must be on record.
    # Same transaction as the write, so the trail can't miss a committed change.
    notes_changed = shown.notes != payload.notes
    if shown.status != payload.status or notes_changed:
        db.add(
            governance_event(
                project_id=project_id,
                user_id=current_user.id,
                entity_type=ENTITY_READINESS,
                entity_id=gate.id,
                action="readiness_updated",
                # ASCII "->": audit columns may be VARCHAR on SQL Server.
                detail=(
                    f"{check.code} for {_target_label(payload)}: "
                    f"{shown.status} -> {payload.status}"
                    + ("; notes changed" if notes_changed else "")
                )[:512],
                old_value=shown.status,
            )
        )

    await db.commit()
    await db.refresh(gate)
    return CheckUpsertResponse.model_validate(gate)


@router.post("/readiness/{check_code}/reset", response_model=EffectiveCheckState)
async def reset_well_override(
    project_id: uuid.UUID,
    check_code: str,
    payload: WellTarget,
    current_user: CurrentUser,
    db: DB,
) -> EffectiveCheckState:
    """"Reset to project": drop a well's own status for a check enabled at both
    levels, so the well follows its field project again (spec §3.6). Idempotent —
    resetting a well with no override returns what it shows. Refused (409) where
    the check doesn't apply to the well — not selected included (phase 7): tick
    it first (§7.10)."""
    check, editor_source = await _resolve_check(check_code, db)
    await assert_can_edit_check(
        project_id,
        team_code=check.team_code,
        editor_source=editor_source,
        user=current_user,
        db=db,
    )
    await lock_campaign_writes(project_id, db)
    if payload.scope != "well" or not (check.applies_project and check.applies_well):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Only a well's value for a check that applies at both levels can be reset",
        )
    await _assert_target_exists(project_id, payload, db)

    key = _well_key(payload)
    # The well's own override, by the database's comparison (a case variant of a
    # stored name finds that row).
    index = await _target_index(db, project_id, [check.code], payload)
    if not well_applies(index, check, key)[0]:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=_NOT_APPLICABLE_DETAIL)
    if check.locks_with_plan:  # never true for a two-level check today; defensive
        await assert_project_not_locked(project_id, db)

    override = index.well.pop((*key, check.code), None)
    # What the well shows once its own entry is gone: the field project's status
    # while the check applies there, else the default (spec §3.8) — never the
    # project's hidden status under an untick.
    now = well_value(index, check, key)
    if override is not None:
        await db.delete(override)
        db.add(
            governance_event(
                project_id=project_id,
                user_id=current_user.id,
                entity_type=ENTITY_READINESS,
                entity_id=override.id,
                action="readiness_reset",
                detail=(
                    f"{check.code} for {_target_label(payload)}: {override.status} -> "
                    f"{now.status} (now follows the field project)"
                )[:512],
                old_value=override.status,
            )
        )
        await db.commit()
    return _well_cell(now)


# ── Checks that apply (phase 6, spec §3.8, §5.1) ────────────────────────────


def _applies_label(applies: bool) -> str:
    return "applies" if applies else "does not apply"


def _default_label(check: ReadinessCheck) -> str:
    """Audit wording for a target with no row — and nothing to follow — which
    reads the check's default (spec §5.3, phase 7): "applies", or "not selected"
    for a check that starts unticked. Never a fixed "applies"."""
    return "applies" if default_applies(check) else "not selected"


@router.put(
    # DS-001: the path carries only the team code; the target's names travel in
    # the body.
    "/readiness/teams/{team_code}/applicability",
    response_model=ApplicabilityResult,
)
async def set_applicability(
    project_id: uuid.UUID,
    team_code: str,
    payload: ApplicabilityUpdate,
    current_user: CurrentUser,
    db: DB,
) -> ApplicabilityResult:
    """Which of a team's checks apply to one target — a field project or a well
    (spec §3.8, §4.4). Not for the Projects team: the Project gates use N/A
    (decision 31), so no check that locks with the plan ever gets a row — and
    this write is never refused with 423 (ticks stay live, like team statuses).

    Each listed code is resolved under the campaign write lock against the
    target's CURRENT state (a client never decides from a value it read earlier):
    - field project: a row is stored only where the choice differs from the
      check's default (``applies_by_default``, phase 7): the default deletes it,
      the other value stores it — ``applies=false`` unticks a check that starts
      ticked, ``applies=true`` nominates one that starts unticked;
    - well: a row is the well's own choice, stored only while it differs from the
      field project's current choice — or, with nothing to follow, the check's
      default (otherwise any row is removed); ``null`` — Follow project — removes
      it whatever the field project says now.
    A code that changes nothing (neither the effective value nor the well's row)
    writes nothing and no audit event; each one that does writes one
    ``readiness_applicability_changed``. All codes change, or none: every code
    is validated before the first write, and there is one commit.
    """
    team = await _resolve_team(team_code, db)
    if team.code == PROJECTS_TEAM:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=_GATES_USE_NA_DETAIL
        )
    await assert_can_edit_check(
        project_id,
        team_code=team.code,
        editor_source=team.editor_source,
        user=current_user,
        db=db,
    )
    await lock_campaign_writes(project_id, db)

    # Every listed code: an active, non-withdrawn check of THIS team (an
    # allow-list — another team's code, a retired or a withdrawn one is a 422),
    # with a tick list, enabled at the target's level.
    team_checks = await active_checks(db, team_code=team.code)
    by_code = {c.code: c for c in team_checks}
    for code in payload.applies:
        check = by_code.get(code)
        if check is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Unknown or retired readiness check for this team",
            )
        if check.locks_with_plan:
            # A governed check outside the Projects team (possible only for one
            # created before 2026-10-16) keeps N/A, like the gates (spec §3.8).
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=_GATES_USE_NA_DETAIL
            )
        _assert_enabled_at(check, payload.scope)
    await _assert_target_exists(project_id, payload, db)

    # The target's own stored rows, by the database's comparison — so a case
    # variant of a stored name updates or removes that row instead of inserting a
    # duplicate.
    index = await _target_index(db, project_id, list(payload.applies), payload)
    target = _target_label(payload)
    changed: list[str] = []
    # Catalog order, so the audit trail reads like the picker.
    for check in (c for c in team_checks if c.code in payload.applies):
        value = payload.applies[check.code]
        if payload.scope == "project":
            change = await _set_project_choice(
                db, project_id, check, payload.well_project, value, index, current_user
            )
        else:
            change = await _set_well_choice(
                db, project_id, check, _well_key(payload), value, index, current_user
            )
        if change is None:
            continue
        entity_id, before, after = change
        db.add(
            governance_event(
                project_id=project_id,
                user_id=current_user.id,
                entity_type=ENTITY_READINESS,
                entity_id=entity_id,
                action="readiness_applicability_changed",
                # Plain words, ASCII "->" (audit columns may be VARCHAR on SQL
                # Server), capped like every readiness detail.
                detail=f"{check.code}: {before} -> {after}; for {target}"[:512],
                old_value=before,
            )
        )
        changed.append(check.code)

    if changed:
        await _flush_or_409(db, project_id, current_user, changed)
        await db.commit()
        # Ids only — no names or emails in logs.
        logger.info(
            "readiness_applicability_changed actor_id=%s project_id=%s team=%s checks=%s",
            current_user.id,
            project_id,
            team.code,
            ",".join(changed),
        )
    project_rows, well_rows = await _team_rows(project_id, team_checks, db, target=payload)
    return ApplicabilityResult(project_rows=project_rows, well_rows=well_rows)


async def _set_project_choice(
    db: AsyncSession,
    project_id: uuid.UUID,
    check: ReadinessCheck,
    well_project: str,
    value: bool | None,
    index: EntryIndex,
    user: User,
) -> tuple[uuid.UUID, str, str] | None:
    """A field project's choice (spec §4.4, §5.1): a row exists only where the
    choice differs from the check's default (``applies_by_default``) —
    ``applies=false`` for a check that starts ticked, ``applies=true`` for one
    that starts unticked (phase 7: nominating equipment). Writing the default
    deletes the row. Returns (audited entity id, before, after), or None when
    nothing changes. ``value`` is never None here (the schema refuses Follow
    project on a field project).

    The state with no row reads the check's default — "applies", or "not
    selected" for a check that starts unticked (§5.3)."""
    want = bool(value)
    default = default_applies(check)
    row = index.project_applies.get((well_project, check.code))
    before = bool(row.applies) if row is not None else default
    if want == before:
        return None
    before_label = _applies_label(before) if row is not None else _default_label(check)
    if want == default and row is not None:
        # Back to the default deletes the row. It is the only case where a row is
        # sure to exist: with none, the field project reads the default already
        # (want == before, returned above).
        await db.delete(row)
        return row.id, before_label, _default_label(check)
    if row is None:
        row = ReadinessApplicability(
            id=uuid.uuid4(),
            project_id=project_id,
            check_code=check.code,
            scope="project",
            well_project=well_project,
            applies=want,
            updated_by=user.id,
        )
        db.add(row)
    else:
        row.applies = want
        row.updated_by = user.id
    return row.id, before_label, _applies_label(want)


async def _set_well_choice(
    db: AsyncSession,
    project_id: uuid.UUID,
    check: ReadinessCheck,
    key: WellKey,
    value: bool | None,
    index: EntryIndex,
    user: User,
) -> tuple[uuid.UUID, str, str] | None:
    """A well's own choice (spec §3.8, §4.4): stored only where it differs from
    its field project's CURRENT choice, otherwise removed; ``None`` (Follow
    project) removes it whatever the field project says. Returns (audited entity
    id, before, after), or None when neither the effective value nor the row
    changes."""
    wp, wn, at = key
    own = index.well_applies.get((wp, wn, at, check.code))
    # The field project's current choice — its row, else the check's default
    # (phase 7: False for a check that starts unticked); the check's default
    # where there's nothing to follow (no field project, or a check not enabled
    # at project level).
    follows, _ = project_applies(index, check, wp)
    can_follow = bool(wp) and check.applies_project
    have = None if own is None else bool(own.applies)
    want = None if value is None or value == follows else value
    if want == have:
        return None

    def label(choice: bool | None) -> str:
        if choice is None:
            # No row: following the field project, or — with nothing to follow —
            # the check's default ("applies" or "not selected", spec §5.3).
            return "follows field project" if can_follow else _default_label(check)
        return _applies_label(choice)

    # Only the row goes — the well already matched its field project.
    before = "set on this well" if want is None and have == follows and can_follow else label(have)
    if want is None:
        assert own is not None  # have != want, so a row exists
        await db.delete(own)
    elif own is None:
        own = ReadinessApplicability(
            id=uuid.uuid4(),
            project_id=project_id,
            check_code=check.code,
            scope="well",
            well_project=wp,
            well_name=wn,
            activity_type=at,
            applies=want,
            updated_by=user.id,
        )
        db.add(own)
    else:
        own.applies = want
        own.updated_by = user.id
    return own.id, before, label(want)


# ── Team lens (read) ────────────────────────────────────────────────────────


@router.get("/readiness/teams/{team_code}", response_model=TeamReadiness)
async def get_team_readiness(
    project_id: uuid.UUID, team_code: str, current_user: CurrentUser, db: DB
) -> TeamReadiness:
    """One team's readiness in this campaign — the Wells / Logistics… lens.

    ``project_rows``: one per field project, the team's project-level checks.
    ``well_rows`` (only when the team has well-level checks): one per well
    activity (project + well + activity type), with every team check the well
    carries at its effective value — the well's own entry, else the field
    project's (inherited while the check applies there), else the default — so a
    chart bar or print row reads one complete strip. Each cell says whether the
    check applies (``applies`` / ``applies_source``, spec §3.8); a Project gate
    always applies — it uses N/A.
    """
    # Reads are org-wide: any authenticated user may view campaign data.
    team = await _resolve_team(team_code, db)
    checks = await active_checks(db, team_code=team.code)
    project_rows, well_rows = await _team_rows(project_id, checks, db)
    return TeamReadiness(
        team=CatalogTeam.model_validate(team),
        checks=[CatalogCheck.model_validate(c) for c in checks],
        project_rows=project_rows,
        well_rows=well_rows,
        locked=await _campaign_locked(project_id, db),
    )
