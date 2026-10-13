import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.locks import assert_project_not_locked
from app.core.rbac import assert_member
from app.database import get_db
from app.models.activity import Activity
from app.models.project import ProjectRole
from app.models.readiness import (
    STATUS_SETS,
    ReadinessCheck,
    ReadinessEntry,
    ReadinessTeam,
)
from app.models.user import User
from app.schemas.readiness import (
    CatalogCheck,
    CatalogTeam,
    CheckState,
    CheckUpsert,
    CheckUpsertResponse,
    ReadinessCatalog,
    StatusOption,
    StatusSet,
)
from app.schemas.readiness import ProjectReadiness as ProjectReadinessSchema
from app.services.readiness_catalog import (
    active_checks,
    active_teams,
    default_status,
    is_valid_status,
    project_gate_checks,
)

router = APIRouter(prefix="/api/projects/{project_id}", tags=["readiness"])
# Campaign-independent catalog reads. Separate router: a different prefix.
catalog_router = APIRouter(prefix="/api/readiness", tags=["readiness"])

CurrentUser = Annotated[User, Depends(get_current_user)]
DB = Annotated[AsyncSession, Depends(get_db)]


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
    # Distinct projects + how many activities each carries (grid context).
    counts_result = await db.execute(
        select(Activity.well_project, func.count(Activity.id))
        .where(Activity.project_id == project_id, Activity.well_project.is_not(None))
        .group_by(Activity.well_project)
        .order_by(Activity.well_project)
    )
    project_counts = [(wp, n) for wp, n in counts_result.all() if wp]
    if not project_counts:
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

    # Earliest not-done, readiness-required activity start per field project — the
    # same signal the Overview readiness KPI uses for its focus window, so the
    # page can filter to exactly the projects a "next N months" card counted.
    # completed_at IS NULL = not done; the bare readiness_required column compiles
    # to ``= 1`` on SQL Server (``.is_(True)`` would be a syntax error there).
    focus_result = await db.execute(
        select(Activity.well_project, func.min(Activity.start_date))
        .where(
            Activity.project_id == project_id,
            Activity.well_project.is_not(None),
            Activity.completed_at.is_(None),
            Activity.readiness_required,
        )
        .group_by(Activity.well_project)
    )
    focus_start_by_project: dict[str, date] = {
        wp: d for wp, d in focus_result.all() if wp and d is not None
    }

    def _state(well_project: str, check: ReadinessCheck) -> CheckState:
        gate = by_gate.get((well_project, check.code))
        if gate is not None:
            return CheckState(status=gate.status, notes=gate.notes, updated_at=gate.updated_at)
        return CheckState(status=default_status(check.status_set), notes=None, updated_at=None)

    return [
        ProjectReadinessSchema(
            well_project=wp,
            checks={c.code: _state(wp, c) for c in checks},
            activity_count=n,
            locked=locked,
            focus_start=focus_start_by_project.get(wp),
        )
        for wp, n in project_counts
    ]


@router.put(
    # ``well_project`` is NOT a path segment: it is free-form user data that can
    # carry "/" ("Gbaran 31/30") or "+" ("Egbema Node FOD + IOGD"), and IIS request
    # filtering rejects '+'/'%2B' in a URL path (404.11) before the request ever
    # reaches uvicorn (ticket DS-001). It travels in the JSON body instead; the
    # path carries only ``check_code``, validated against the catalog below.
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
    """Set one gate's status for a field-development project — shared by every
    activity under that project."""
    await assert_member(project_id, current_user, db, allowed_roles={ProjectRole.planner})
    well_project = payload.well_project

    # The check must be an ACTIVE catalog check that applies at field-project level
    # (the only scope this endpoint writes until Phase 3). The catalog is public,
    # so a generic 422 leaks nothing.
    row = (
        await db.execute(
            select(ReadinessCheck, ReadinessTeam.editor_source)
            .join(ReadinessTeam, ReadinessTeam.code == ReadinessCheck.team_code)
            .where(
                ReadinessCheck.code == check_code,
                ReadinessCheck.retired_at.is_(None),
                # Bare boolean columns compile to "= 1" on SQL Server;
                # .is_(True) would render "IS 1", a syntax error there.
                ReadinessCheck.applies_project,
                ReadinessTeam.is_active,
            )
        )
    ).one_or_none()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Unknown or retired readiness check",
        )
    check, editor_source = row
    # Default deny: only planner-edited checks are writable until team grants
    # land (Phase 2). The planner gate above already ran; admins bypass it.
    if editor_source != "planner" and not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient role for this action",
        )
    if not is_valid_status(check.status_set, payload.status):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid status for this readiness check",
        )
    # The project must actually exist in this campaign (BOLA: scoped by project_id)
    # — no inventing readiness for a field project with no activities here.
    exists = (
        await db.execute(
            select(Activity.id)
            .where(Activity.project_id == project_id, Activity.well_project == well_project)
            .limit(1)
        )
    ).scalar_one_or_none()
    if exists is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No activities under that project in this campaign",
        )

    # Governed checks are part of the snapshot under approval — they freeze with
    # the plan. (Operational checks, Phase 3+, stay editable.)
    if check.locks_with_plan:
        await assert_project_not_locked(project_id, db)

    gate = (
        await db.execute(
            select(ReadinessEntry).where(
                ReadinessEntry.project_id == project_id,
                ReadinessEntry.check_code == check.code,
                ReadinessEntry.scope == "project",
                ReadinessEntry.well_project == well_project,
                ReadinessEntry.well_name == "",
                ReadinessEntry.activity_type == "",
            )
        )
    ).scalar_one_or_none()

    if gate is None:
        gate = ReadinessEntry(
            project_id=project_id,
            check_code=check.code,
            scope="project",
            well_project=well_project,
            well_name="",
            activity_type="",
            status=payload.status,
            notes=payload.notes,
            updated_by=current_user.id,
        )
        db.add(gate)
    else:
        gate.status = payload.status
        gate.notes = payload.notes
        gate.updated_by = current_user.id

    await db.commit()
    await db.refresh(gate)
    return CheckUpsertResponse.model_validate(gate)
