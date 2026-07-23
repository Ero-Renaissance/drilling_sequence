import uuid
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
from app.models.readiness import CHECK_CODES, ProjectReadiness
from app.models.user import User
from app.schemas.readiness import (
    CheckState,
    CheckUpsert,
    CheckUpsertResponse,
)
from app.schemas.readiness import ProjectReadiness as ProjectReadinessSchema

router = APIRouter(prefix="/api/projects/{project_id}", tags=["readiness"])

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


@router.get("/readiness", response_model=list[ProjectReadinessSchema])
async def list_readiness(
    project_id: uuid.UUID, current_user: CurrentUser, db: DB
) -> list[ProjectReadinessSchema]:
    """Readiness per FIELD-DEVELOPMENT PROJECT (the "Project" column). One entry
    per distinct ``well_project`` in the campaign, each with its seven gates.
    Activities with no project have no gates and are omitted.
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

    gates_result = await db.execute(
        select(ProjectReadiness).where(ProjectReadiness.project_id == project_id)
    )
    by_gate: dict[tuple[str, str], ProjectReadiness] = {
        (g.well_project, g.check_code): g for g in gates_result.scalars().all()
    }
    locked = await _campaign_locked(project_id, db)

    def _state(well_project: str, code: str) -> CheckState:
        gate = by_gate.get((well_project, code))
        if gate is not None:
            return CheckState(status=gate.status, notes=gate.notes, updated_at=gate.updated_at)
        return CheckState(status="On Track", notes=None, updated_at=None)

    return [
        ProjectReadinessSchema(
            well_project=wp,
            checks={code: _state(wp, code) for code in CHECK_CODES},
            activity_count=n,
            locked=locked,
        )
        for wp, n in project_counts
    ]


@router.put(
    # ``well_project`` is user data (e.g. the block "Gbaran 31/30") and can contain
    # slashes. The frontend percent-encodes it, but uvicorn/Starlette decode %2F
    # back to "/" BEFORE routing, so a plain ``{well_project}`` segment would split
    # on the slash and 404. The ``:path`` converter lets it span slashes; the
    # trailing ``{check_code}`` stays a single clean segment (a fixed enum,
    # validated below).
    "/readiness/{well_project:path}/{check_code}",
    response_model=CheckUpsertResponse,
)
async def upsert_readiness_check(
    project_id: uuid.UUID,
    well_project: str,
    check_code: str,
    payload: CheckUpsert,
    current_user: CurrentUser,
    db: DB,
) -> CheckUpsertResponse:
    """Set one gate's status for a field-development project — shared by every
    activity under that project."""
    await assert_member(project_id, current_user, db, allowed_roles={ProjectRole.planner})

    if check_code not in CHECK_CODES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid check code '{check_code}'. Must be one of: {', '.join(CHECK_CODES)}",
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

    # Readiness is part of the snapshot under approval — freeze it with the plan.
    await assert_project_not_locked(project_id, db)

    gate = (
        await db.execute(
            select(ProjectReadiness).where(
                ProjectReadiness.project_id == project_id,
                ProjectReadiness.well_project == well_project,
                ProjectReadiness.check_code == check_code,
            )
        )
    ).scalar_one_or_none()

    if gate is None:
        gate = ProjectReadiness(
            project_id=project_id,
            well_project=well_project,
            check_code=check_code,
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
