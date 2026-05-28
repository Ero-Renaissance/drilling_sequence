import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.rbac import assert_member
from app.database import get_db
from app.models.activity import Activity
from app.models.project import ProjectRole
from app.models.readiness import CHECK_CODES, ReadinessCheck
from app.models.rig_contract import RigContract
from app.models.user import User
from app.schemas.readiness import (
    ActivityReadiness,
    CheckState,
    CheckStatus,
    CheckUpsert,
    CheckUpsertResponse,
)


def _derive_con_status(
    activity: Activity, contract: RigContract | None, today: date
) -> CheckStatus:
    """Derive the CON (Contract) readiness status for an activity.

    The rig contract is a WORKFLOW item: the planner explicitly sets its status
    (Not Applicable / Not Started / In Progress / Completed). Dates are only
    binding when status == "Completed" — at which point we check whether the
    end date actually covers this activity (gate). For every other workflow
    state the per-activity CON status simply mirrors the contract's workflow
    status, because there's nothing committed to gate against yet.

    Rules:
      • activity has no rig_name                 → N/A
      • no contract row on file for that rig     → Not Started
      • contract.status == "N/A"                 → N/A
      • contract.status == "Not Started"         → Not Started
      • contract.status == "In Progress"         → In Progress
      • contract.status == "Completed":
            – contract_end is null               → In Progress (data missing)
            – end < activity end                 → Behind (won't cover)
            – end ≥ activity end                 → Completed (covers)
    """
    # `today` accepted for API symmetry; the gate doesn't depend on it.
    del today

    if not activity.rig_name:
        return "N/A"
    if contract is None:
        return "Not Started"

    status = contract.status
    if status == "N/A":
        return "N/A"
    if status == "Not Started":
        return "Not Started"
    if status == "In Progress":
        return "In Progress"

    # status == "Completed" — only now do dates carry weight.
    if contract.contract_end is None:
        return "In Progress"
    if activity.end_date and contract.contract_end < activity.end_date:
        return "Behind"
    return "Completed"

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

    # CON is derived from rig contracts, not stored per-activity.
    contracts_result = await db.execute(
        select(RigContract).where(RigContract.project_id == project_id)
    )
    contracts_by_rig: dict[str, RigContract] = {
        c.rig_name: c for c in contracts_result.scalars().all()
    }
    today = date.today()

    rows: list[ActivityReadiness] = []
    for act in activities:
        activity_checks = checks_by_activity.get(act.id, {})
        con_contract = contracts_by_rig.get(act.rig_name) if act.rig_name else None
        con_status = _derive_con_status(act, con_contract, today)

        def _state(code: str) -> CheckState:
            if code == "CON":
                return CheckState(
                    status=con_status,
                    notes=con_contract.notes if con_contract else None,
                    updated_at=con_contract.updated_at if con_contract else None,
                )
            if code in activity_checks:
                return CheckState(
                    status=activity_checks[code].status,
                    notes=activity_checks[code].notes,
                    updated_at=activity_checks[code].updated_at,
                )
            return CheckState(status="Not Started", notes=None, updated_at=None)

        rows.append(
            ActivityReadiness(
                activity_id=act.id,
                activity_type=act.activity_type,
                well_name=act.well_name,
                rig_name=act.rig_name,
                start_date=act.start_date,
                end_date=act.end_date,
                checks={code: _state(code) for code in CHECK_CODES},
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
    if check_code == "CON":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "CON status is derived from the rig contract — edit the rig's contract "
                "via PUT /api/projects/{project_id}/contracts/{rig_name} instead."
            ),
        )

    act_result = await db.execute(
        select(Activity).where(
            Activity.id == activity_id,
            Activity.project_id == project_id,
        )
    )
    if act_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Activity not found")

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
