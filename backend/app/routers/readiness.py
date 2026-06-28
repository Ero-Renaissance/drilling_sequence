import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.locks import ensure_activity_unlocked
from app.core.rbac import assert_member
from app.database import get_db
from app.models.activity import Activity
from app.models.project import ProjectRole
from app.models.readiness import CHECK_CODES, ReadinessCheck
from app.models.user import User
from app.schemas.readiness import (
    ActivityReadiness,
    CheckState,
    CheckUpsert,
    CheckUpsertResponse,
)

router = APIRouter(prefix="/api/projects/{project_id}", tags=["readiness"])

CurrentUser = Annotated[User, Depends(get_current_user)]
DB = Annotated[AsyncSession, Depends(get_db)]


@router.get("/readiness", response_model=list[ActivityReadiness])
async def list_readiness(
    project_id: uuid.UUID, current_user: CurrentUser, db: DB
) -> list[ActivityReadiness]:
    await assert_member(project_id, current_user, db)

    acts_result = await db.execute(
        select(Activity)
        .where(Activity.project_id == project_id)
        .order_by(Activity.start_date)
    )
    activities = acts_result.scalars().all()
    if not activities:
        return []

    activity_ids = [a.id for a in activities]
    checks_result = await db.execute(
        select(ReadinessCheck).where(ReadinessCheck.activity_id.in_(activity_ids))
    )
    # Index: activity_id → { check_code → ReadinessCheck }
    checks_by_activity: dict[uuid.UUID, dict[str, ReadinessCheck]] = {}
    for check in checks_result.scalars().all():
        checks_by_activity.setdefault(check.activity_id, {})[check.check_code] = check

    rows: list[ActivityReadiness] = []
    for act in activities:
        activity_checks = checks_by_activity.get(act.id, {})

        def _state(code: str) -> CheckState:
            if code in activity_checks:
                return CheckState(
                    status=activity_checks[code].status,
                    notes=activity_checks[code].notes,
                    updated_at=activity_checks[code].updated_at,
                )
            return CheckState(status="On Track", notes=None, updated_at=None)

        rows.append(
            ActivityReadiness(
                activity_id=act.id,
                activity_type=act.activity_type,
                well_name=act.well_name,
                rig_name=act.rig_name,
                hwu_name=act.hwu_name,
                start_date=act.start_date,
                end_date=act.end_date,
                checks={code: _state(code) for code in CHECK_CODES},
                locked=act.locked_by_revision_id is not None,
            )
        )
    return rows


@router.put(
    "/activities/{activity_id}/readiness/{check_code}",
    response_model=CheckUpsertResponse,
)
async def upsert_readiness_check(
    project_id: uuid.UUID,
    activity_id: uuid.UUID,
    check_code: str,
    payload: CheckUpsert,
    current_user: CurrentUser,
    db: DB,
) -> CheckUpsertResponse:
    await assert_member(project_id, current_user, db, allowed_roles={ProjectRole.planner})

    if check_code not in CHECK_CODES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid check code '{check_code}'. Must be one of: {', '.join(CHECK_CODES)}",
        )
    act_result = await db.execute(
        select(Activity).where(
            Activity.id == activity_id,
            Activity.project_id == project_id,
        )
    )
    activity = act_result.scalar_one_or_none()
    if activity is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Activity not found")

    # Readiness state is part of the snapshot under approval — freeze it too.
    ensure_activity_unlocked(activity)

    check_result = await db.execute(
        select(ReadinessCheck).where(
            ReadinessCheck.activity_id == activity_id,
            ReadinessCheck.check_code == check_code,
        )
    )
    check = check_result.scalar_one_or_none()

    if check is None:
        check = ReadinessCheck(
            activity_id=activity_id,
            check_code=check_code,
            status=payload.status,
            notes=payload.notes,
        )
        db.add(check)
    else:
        check.status = payload.status
        check.notes = payload.notes

    await db.commit()
    await db.refresh(check)
    return CheckUpsertResponse.model_validate(check)
