import uuid
from collections.abc import Iterable
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.locks import assert_project_not_locked
from app.core.rbac import assert_can_edit_check
from app.database import get_db
from app.models.activity import Activity
from app.models.readiness import (
    STATUS_SETS,
    ReadinessCheck,
    ReadinessEntry,
    ReadinessEntryTag,
    ReadinessTeam,
)
from app.models.user import User
from app.schemas.readiness import (
    CatalogCheck,
    CatalogTeam,
    CheckState,
    CheckUpsert,
    CheckUpsertResponse,
    EffectiveCheckState,
    ReadinessCatalog,
    RowFigures,
    StatusOption,
    StatusSet,
    TagItem,
    TeamProjectRow,
    TeamReadiness,
    TeamWellRow,
    WellTarget,
)
from app.schemas.readiness import ProjectReadiness as ProjectReadinessSchema
from app.services.audit import ENTITY_READINESS, governance_event
from app.services.readiness_catalog import (
    active_checks,
    active_tag_items,
    active_teams,
    default_status,
    is_valid_status,
    project_gate_checks,
)
from app.services.readiness_effective import (
    Effective,
    load_index,
    project_value,
    well_value,
)
from app.services.readiness_rollup import days_until, focus_start_of, target_figures

router = APIRouter(prefix="/api/projects/{project_id}", tags=["readiness"])
# Campaign-independent catalog reads. Separate router: a different prefix.
catalog_router = APIRouter(prefix="/api/readiness", tags=["readiness"])

CurrentUser = Annotated[User, Depends(get_current_user)]
DB = Annotated[AsyncSession, Depends(get_db)]


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
    """True while any activity in the campaign is frozen by a pending revision —
    readiness is part of the snapshot under approval, so it freezes with it."""
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
    """Active teams and checks, plus the code-defined status sets with their
    shared severities. Read by every authenticated user (reads are org-wide):
    the frontend renders columns, icons and legends from it."""
    teams = await active_teams(db)
    team_codes = {t.code for t in teams}
    checks = [c for c in await active_checks(db) if c.team_code in team_codes]
    return ReadinessCatalog(
        teams=[CatalogTeam.model_validate(t) for t in teams],
        checks=[CatalogCheck.model_validate(c) for c in checks],
        status_sets={
            name: StatusSet(
                statuses=[
                    StatusOption(status=s, severity=sev)
                    for s, sev in spec["statuses"].items()
                ],
                default=spec["default"],
            )
            for name, spec in STATUS_SETS.items()
        },
        tag_items=[TagItem.model_validate(t) for t in await active_tag_items(db)],
    )


@router.get("/readiness", response_model=list[ProjectReadinessSchema])
async def list_readiness(
    project_id: uuid.UUID, current_user: CurrentUser, db: DB
) -> list[ProjectReadinessSchema]:
    """Readiness per FIELD-DEVELOPMENT PROJECT (the "Project" column). One entry
    per distinct ``well_project`` in the campaign, each with the catalog's active
    project gates. Activities with no project have no gates and are omitted.
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


async def _resolve_check(check_code: str, db: AsyncSession) -> tuple[ReadinessCheck, str]:
    """The ACTIVE catalog check (of an active team) and its team's editor source.
    The catalog is public (GET /api/readiness/catalog), so resolving it before
    authorization — its team decides who may write — leaks nothing."""
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
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Unknown or retired readiness check",
        )
    return row[0], row[1]


async def _assert_target_exists(
    project_id: uuid.UUID, target: WellTarget, db: AsyncSession
) -> None:
    """BOLA: the field project / well must exist in THIS campaign — no inventing
    readiness for names with no activities here."""
    stmt = select(Activity.id).where(
        Activity.project_id == project_id, _well_project_filter(target.well_project)
    )
    if target.scope == "well":
        stmt = stmt.where(
            Activity.well_name == target.well_name,
            Activity.activity_type == target.activity_type,
        )
    if (await db.execute(stmt.limit(1))).scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No matching activities in this campaign",
        )


async def _entry(
    project_id: uuid.UUID,
    check_code: str,
    scope: str,
    well_project: str,
    well_name: str,
    activity_type: str,
    db: AsyncSession,
) -> ReadinessEntry | None:
    return (
        await db.execute(
            select(ReadinessEntry).where(
                ReadinessEntry.project_id == project_id,
                ReadinessEntry.check_code == check_code,
                ReadinessEntry.scope == scope,
                ReadinessEntry.well_project == well_project,
                ReadinessEntry.well_name == well_name,
                ReadinessEntry.activity_type == activity_type,
            )
        )
    ).scalar_one_or_none()


async def _inherited(
    project_id: uuid.UUID, check: ReadinessCheck, well_project: str, db: AsyncSession
) -> tuple[str, str | None, str]:
    """What a well without its own entry shows for ``check``: the field project's
    entry (checks that also apply at project level), else the default.
    Returns (status, notes, source)."""
    if check.applies_project and well_project:
        project_entry = await _entry(project_id, check.code, "project", well_project, "", "", db)
        if project_entry is not None:
            return project_entry.status, project_entry.notes, "project"
    return default_status(check.status_set), None, "default"


async def _entry_tags(entry_id: uuid.UUID, db: AsyncSession) -> list[str]:
    return list(
        (
            await db.execute(
                select(ReadinessEntryTag.item_code)
                .where(ReadinessEntryTag.entry_id == entry_id)
                .order_by(ReadinessEntryTag.item_code)
            )
        ).scalars()
    )


async def _validated_tags(
    check: ReadinessCheck, tags: list[str] | None, db: AsyncSession
) -> list[str] | None:
    """The requested tags, de-duplicated (order kept), each an ACTIVE item of the
    check's tag list — 422 otherwise. None = leave the entry's tags unchanged."""
    if tags is None:
        return None
    if not check.tag_list:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="This readiness check doesn't carry tags",
        )
    wanted = list(dict.fromkeys(tags))
    allowed = {t.code for t in await active_tag_items(db, check.tag_list)}
    if any(code not in allowed for code in wanted):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Unknown or retired tag for this readiness check",
        )
    return wanted


def _target_label(target: WellTarget) -> str:
    """Audit wording for a target. ASCII only: audit columns may be VARCHAR on
    SQL Server."""
    if target.scope == "project":
        return target.well_project
    project = target.well_project or "no field project"
    return f"{target.well_name} ({project}, {target.activity_type})"


# ── Writes ──────────────────────────────────────────────────────────────────


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
    """Set one check's value for a field project (shared by every activity under
    it) or for one well (``scope="well"``: project + well + activity type). Who may
    write depends on the check's team (``assert_can_edit_check``): planners for
    the project gates, team-grant holders for Wells/Logistics…, admins for all."""
    check, editor_source = await _resolve_check(check_code, db)
    await assert_can_edit_check(
        project_id,
        team_code=check.team_code,
        editor_source=editor_source,
        user=current_user,
        db=db,
    )
    applies = check.applies_project if payload.scope == "project" else check.applies_well
    if not applies:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="This readiness check doesn't apply at that level",
        )
    if not is_valid_status(check.status_set, payload.status):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid status for this readiness check",
        )
    new_tags = await _validated_tags(check, payload.tags, db)
    await _assert_target_exists(project_id, payload, db)

    # Governed checks are part of the snapshot under approval — they freeze with
    # the plan. Operational checks (well, logistics…) stay editable.
    if check.locks_with_plan:
        await assert_project_not_locked(project_id, db)

    well_name = payload.well_name or ""
    activity_type = payload.activity_type or ""
    gate = await _entry(
        project_id, check.code, payload.scope, payload.well_project, well_name, activity_type, db
    )

    # What the user saw before this write: the entry itself, else (for a well)
    # the inherited project value, else the status set's default — so saving the
    # value already shown is not a change.
    old_tags = await _entry_tags(gate.id, db) if gate is not None else []
    if gate is not None:
        old_status, old_notes = gate.status, gate.notes
    elif payload.scope == "well":
        old_status, old_notes, _ = await _inherited(project_id, check, payload.well_project, db)
    else:
        old_status, old_notes = default_status(check.status_set), None

    if gate is None:
        gate = ReadinessEntry(
            project_id=project_id,
            check_code=check.code,
            scope=payload.scope,
            well_project=payload.well_project,
            well_name=well_name,
            activity_type=activity_type,
            status=payload.status,
            notes=payload.notes,
            updated_by=current_user.id,
        )
        db.add(gate)
    else:
        gate.status = payload.status
        gate.notes = payload.notes
        gate.updated_by = current_user.id

    await db.flush()  # assigns gate.id for a new entry
    tags_now = old_tags
    if new_tags is not None and new_tags != old_tags:
        await db.execute(delete(ReadinessEntryTag).where(ReadinessEntryTag.entry_id == gate.id))
        db.add_all(ReadinessEntryTag(entry_id=gate.id, item_code=code) for code in new_tags)
        tags_now = new_tags

    # Every real change is audited — `updated_by` only remembers the LAST editor,
    # and team grants span every campaign, so the full history must be on record.
    # Same transaction as the write, so the trail can't miss a committed change.
    notes_changed = old_notes != payload.notes
    added = [t for t in tags_now if t not in old_tags]
    removed = [t for t in old_tags if t not in tags_now]
    tag_note = (
        "; tags " + " ".join([*(f"+{t}" for t in added), *(f"-{t}" for t in removed)])
        if added or removed
        else ""
    )
    if old_status != payload.status or notes_changed or tag_note:
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
                    f"{old_status} -> {payload.status}"
                    + ("; notes changed" if notes_changed else "")
                    + tag_note
                )[:512],
                old_value=old_status,
            )
        )

    await db.commit()
    await db.refresh(gate)
    response = CheckUpsertResponse.model_validate(gate)
    response.tags = tags_now
    return response


@router.post("/readiness/{check_code}/reset", response_model=EffectiveCheckState)
async def reset_well_override(
    project_id: uuid.UUID,
    check_code: str,
    payload: WellTarget,
    current_user: CurrentUser,
    db: DB,
) -> EffectiveCheckState:
    """"Reset to project": drop a well's own value for a check that applies at
    both levels, so the well follows its field project again (spec §3.6).
    Idempotent — resetting a well with no override returns what it shows."""
    check, editor_source = await _resolve_check(check_code, db)
    await assert_can_edit_check(
        project_id,
        team_code=check.team_code,
        editor_source=editor_source,
        user=current_user,
        db=db,
    )
    if payload.scope != "well" or not (check.applies_project and check.applies_well):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Only a well's value for a check that applies at both levels can be reset",
        )
    await _assert_target_exists(project_id, payload, db)
    if check.locks_with_plan:  # never true for a two-level check today; defensive
        await assert_project_not_locked(project_id, db)

    override = await _entry(
        project_id,
        check.code,
        "well",
        payload.well_project,
        payload.well_name or "",
        payload.activity_type or "",
        db,
    )
    status_now, notes_now, source = await _inherited(project_id, check, payload.well_project, db)
    if override is not None:
        db.add(
            governance_event(
                project_id=project_id,
                user_id=current_user.id,
                entity_type=ENTITY_READINESS,
                entity_id=override.id,
                action="readiness_reset",
                detail=(
                    f"{check.code} for {_target_label(payload)}: {override.status} -> "
                    f"{status_now} (now follows the field project)"
                )[:512],
                old_value=override.status,
            )
        )
        await db.execute(
            delete(ReadinessEntryTag).where(ReadinessEntryTag.entry_id == override.id)
        )
        await db.delete(override)
        await db.commit()
    index = await load_index(db, project_id, [check.code])
    inherited = project_value(index, check, payload.well_project)
    return EffectiveCheckState(
        status=status_now,
        notes=notes_now,
        updated_at=None,
        source=source,
        inherited_tags=inherited.tags if inherited.source == "project" else [],
    )


# ── Team lens (read) ────────────────────────────────────────────────────────


@router.get("/readiness/teams/{team_code}", response_model=TeamReadiness)
async def get_team_readiness(
    project_id: uuid.UUID, team_code: str, current_user: CurrentUser, db: DB
) -> TeamReadiness:
    """One team's readiness in this campaign — the Wells / Logistics… lens.

    ``project_rows``: one per field project, the team's project-level checks.
    ``well_rows`` (only when the team has well-level checks): one per well
    activity (project + well + activity type), with EVERY team check's effective
    value — the well's own entry, else the field project's (inherited), else the
    default — so a chart bar or print row reads one complete strip.
    """
    # Reads are org-wide: any authenticated user may view campaign data.
    team = (
        await db.execute(
            select(ReadinessTeam).where(ReadinessTeam.code == team_code, ReadinessTeam.is_active)
        )
    ).scalar_one_or_none()
    if team is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")
    checks = await active_checks(db, team_code=team.code)
    index = await load_index(db, project_id, [c.code for c in checks])

    activities = (
        await db.execute(
            select(
                Activity.well_project,
                Activity.well_name,
                Activity.activity_type,
                Activity.location,
                Activity.start_date,
                Activity.completed_at,
                Activity.readiness_required,
            ).where(Activity.project_id == project_id)
        )
    ).all()

    def state(value: Effective) -> CheckState:
        return CheckState(
            status=value.status, notes=value.notes, updated_at=value.updated_at, tags=value.tags
        )

    today = date.today()
    project_checks = [c for c in checks if c.applies_project]
    project_rows: list[TeamProjectRow] = []
    if project_checks:
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
                    checks={code: state(v) for code, v in values.items()},
                    focus_start=focus,
                    focus_in_days=days_until(focus, today),
                    figures=_row_figures(v.status for v in values.values()),
                )
            )

    well_rows: list[TeamWellRow] = []
    if any(c.applies_well for c in checks):
        groups: dict[tuple[str, str, str], list] = {}
        for a in activities:
            # No well name → no well gates; readiness opt-out → no readiness at all
            # (from any team — decided 2026-10-14).
            if a.well_name and a.readiness_required:
                key = (a.well_project or "", a.well_name, a.activity_type)
                groups.setdefault(key, []).append(a)

        for key, acts in groups.items():
            acts.sort(key=lambda a: a.start_date)
            focus = focus_start_of(acts)
            cells = {
                c.code: EffectiveCheckState(
                    status=(v := well_value(index, c, key)).status,
                    notes=v.notes,
                    updated_at=v.updated_at,
                    source=v.source,
                    tags=v.tags,
                    inherited_tags=v.inherited_tags,
                )
                for c in checks
            }
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
                    checks=cells,
                    figures=_row_figures(cell.status for cell in cells.values()),
                )
            )
        well_rows.sort(key=lambda r: (r.start_date, r.well_project, r.well_name, r.activity_type))

    return TeamReadiness(
        team=CatalogTeam.model_validate(team),
        checks=[CatalogCheck.model_validate(c) for c in checks],
        project_rows=project_rows,
        well_rows=well_rows,
        locked=await _campaign_locked(project_id, db),
    )
