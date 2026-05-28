import io
import uuid
from datetime import datetime, timezone
from typing import Annotated

import pandas as pd
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.rbac import assert_member
from app.database import get_db
from app.models.activity import Activity
from app.models.audit import AuditLog
from app.models.project import ProjectRole
from app.models.user import User
from app.schemas.activity import ActivityCreate, ActivityResponse, ActivityUpdate, ImportResponse
from app.schemas.audit import AuditEntryResponse
from app.services.data_processor import csv_df_to_db_rows, validate_csv_columns

router = APIRouter(prefix="/api/projects/{project_id}/activities", tags=["activities"])

CurrentUser = Annotated[User, Depends(get_current_user)]
DB = Annotated[AsyncSession, Depends(get_db)]

# Fields excluded from the audit log and conflict check
_AUDIT_EXCLUDE = {"expected_updated_at"}


def _normalize_ts(ts: datetime) -> datetime:
    """Ensure timezone-aware UTC datetime for comparison."""
    if ts.tzinfo is None:
        return ts.replace(tzinfo=timezone.utc)
    return ts.astimezone(timezone.utc)


@router.get("", response_model=list[ActivityResponse])
async def list_activities(
    project_id: uuid.UUID, current_user: CurrentUser, db: DB
) -> list[ActivityResponse]:
    await assert_member(project_id, current_user, db)
    result = await db.execute(
        select(Activity)
        .where(Activity.project_id == project_id)
        .order_by(Activity.start_date)
    )
    return [ActivityResponse.model_validate(a) for a in result.scalars().all()]


@router.post("", response_model=ActivityResponse, status_code=status.HTTP_201_CREATED)
async def create_activity(
    project_id: uuid.UUID, payload: ActivityCreate, current_user: CurrentUser, db: DB
) -> ActivityResponse:
    await assert_member(project_id, current_user, db, allowed_roles={ProjectRole.planner})
    activity = Activity(project_id=project_id, updated_by=current_user.id, **payload.model_dump())
    db.add(activity)
    await db.commit()
    await db.refresh(activity)
    return ActivityResponse.model_validate(activity)


@router.patch("/{activity_id}", response_model=ActivityResponse)
async def update_activity(
    project_id: uuid.UUID,
    activity_id: uuid.UUID,
    payload: ActivityUpdate,
    current_user: CurrentUser,
    db: DB,
) -> ActivityResponse:
    await assert_member(project_id, current_user, db, allowed_roles={ProjectRole.planner})
    result = await db.execute(
        select(Activity).where(
            Activity.id == activity_id, Activity.project_id == project_id
        )
    )
    activity = result.scalar_one_or_none()
    if activity is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Activity not found")

    # ── Optimistic lock check ──────────────────────────────────────────────────
    if payload.expected_updated_at is not None:
        db_ts = _normalize_ts(activity.updated_at)
        client_ts = _normalize_ts(payload.expected_updated_at)
        if abs((db_ts - client_ts).total_seconds()) > 1:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "conflict",
                    "message": "Another user modified this activity after you loaded it.",
                    "updated_by": activity.updated_by_name or "Unknown",
                    "updated_at": activity.updated_at.isoformat(),
                },
            )

    # ── Apply changes & write audit log ───────────────────────────────────────
    changes = payload.model_dump(exclude_unset=True, exclude=_AUDIT_EXCLUDE)
    for field, new_val in changes.items():
        old_val = getattr(activity, field)
        if old_val != new_val:
            db.add(AuditLog(
                project_id=project_id,
                user_id=current_user.id,
                entity_type="activity",
                entity_id=activity_id,
                field=field,
                old_value=str(old_val) if old_val is not None else None,
                new_value=str(new_val) if new_val is not None else None,
            ))
        setattr(activity, field, new_val)

    activity.updated_by = current_user.id
    activity.updated_at = datetime.now(timezone.utc)  # explicit for microsecond precision
    await db.commit()
    await db.refresh(activity)
    return ActivityResponse.model_validate(activity)


@router.delete("/{activity_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_activity(
    project_id: uuid.UUID, activity_id: uuid.UUID, current_user: CurrentUser, db: DB
) -> None:
    await assert_member(project_id, current_user, db, allowed_roles={ProjectRole.planner})
    result = await db.execute(
        select(Activity).where(
            Activity.id == activity_id, Activity.project_id == project_id
        )
    )
    activity = result.scalar_one_or_none()
    if activity is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Activity not found")
    await db.delete(activity)
    await db.commit()


@router.get("/{activity_id}/history", response_model=list[AuditEntryResponse])
async def get_activity_history(
    project_id: uuid.UUID,
    activity_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
    limit: int = Query(default=50, le=200),
) -> list[AuditEntryResponse]:
    await assert_member(project_id, current_user, db)
    result = await db.execute(
        select(AuditLog)
        .where(
            AuditLog.entity_type == "activity",
            AuditLog.entity_id == activity_id,
            AuditLog.project_id == project_id,
        )
        .order_by(AuditLog.timestamp.desc())
        .limit(limit)
    )
    return [AuditEntryResponse.model_validate(e) for e in result.scalars().all()]


@router.post("/import", response_model=ImportResponse)
async def import_activities(
    project_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
    file: UploadFile = File(...),
    replace: bool = Query(default=True, description="Replace all existing activities"),
) -> ImportResponse:
    """Upload a CSV or Excel file and bulk-insert activities into the project."""
    await assert_member(project_id, current_user, db, allowed_roles={ProjectRole.planner})

    content = await file.read()
    filename = file.filename or ""

    try:
        if filename.endswith((".xlsx", ".xls")):
            df = pd.read_excel(io.BytesIO(content))
        else:
            df = pd.read_csv(io.BytesIO(content))
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Could not parse file: {exc}",
        ) from exc

    try:
        validate_csv_columns(df)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc

    rows = csv_df_to_db_rows(df, str(project_id))

    if replace:
        await db.execute(delete(Activity).where(Activity.project_id == project_id))

    for row in rows:
        db.add(Activity(**{**row, "project_id": project_id, "updated_by": current_user.id}))

    await db.commit()
    return ImportResponse(imported=len(rows), replaced=replace)
