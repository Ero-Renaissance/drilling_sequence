import io
import uuid
from datetime import datetime, timezone
from typing import Annotated

import pandas as pd
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from pydantic import ValidationError
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.locks import assert_project_not_locked, ensure_activity_unlocked
from app.core.rbac import assert_member
from app.database import get_db
from app.models.activity import Activity
from app.models.audit import AuditLog
from app.models.project import ProjectRole
from app.models.readiness import CHECK_CODES, CHECK_STATUSES, ReadinessCheck
from app.models.rig_contract import RigContract
from app.models.user import User
from app.schemas.activity import (
    ActivityCreate,
    ActivityCreateStrict,
    ActivityResponse,
    ActivityUpdate,
    ImportResponse,
)
from app.schemas.audit import AuditEntryResponse
from app.services.data_processor import (
    csv_df_to_db_rows,
    is_long_schedule,
    parse_long_schedule,
    validate_csv_columns,
)

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
    project_id: uuid.UUID, payload: ActivityCreateStrict, current_user: CurrentUser, db: DB
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

    ensure_activity_unlocked(activity)

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
    # An activity is scheduled on a rig OR an HWU, never both. Check the MERGED
    # state — a field absent from this payload keeps its current value.
    if changes.get("rig_name", activity.rig_name) and changes.get(
        "hwu_name", activity.hwu_name
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="an activity uses either a rig or an HWU, not both; clear one first",
        )
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


async def _set_completion(
    project_id: uuid.UUID,
    activity_id: uuid.UUID,
    completed: bool,
    current_user: User,
    db: AsyncSession,
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

    ensure_activity_unlocked(activity)

    new_value = datetime.now(timezone.utc) if completed else None
    db.add(AuditLog(
        project_id=project_id,
        user_id=current_user.id,
        entity_type="activity",
        entity_id=activity_id,
        field="completed_at",
        old_value=activity.completed_at.isoformat() if activity.completed_at else None,
        new_value=new_value.isoformat() if new_value else None,
    ))
    activity.completed_at = new_value
    activity.updated_by = current_user.id
    activity.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(activity)
    return ActivityResponse.model_validate(activity)


@router.post("/{activity_id}/complete", response_model=ActivityResponse)
async def complete_activity(
    project_id: uuid.UUID, activity_id: uuid.UUID, current_user: CurrentUser, db: DB
) -> ActivityResponse:
    """Close a completed activity. Completed activities are dropped when the
    project is cloned into the next quarter."""
    return await _set_completion(project_id, activity_id, True, current_user, db)


@router.post("/{activity_id}/reopen", response_model=ActivityResponse)
async def reopen_activity(
    project_id: uuid.UUID, activity_id: uuid.UUID, current_user: CurrentUser, db: DB
) -> ActivityResponse:
    """Reopen a previously completed activity."""
    return await _set_completion(project_id, activity_id, False, current_user, db)


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

    ensure_activity_unlocked(activity)
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
    """Upload a CSV or Excel file and bulk-insert activities into the project.

    Every row is validated through the same `ActivityCreate` schema the JSON API
    uses, so an import cannot smuggle in NULL/invalid dates, end-before-start
    ranges, or non-canonical enum values that a direct POST would reject. The file
    is validated in full *before* any write, so a single bad row never deletes the
    existing schedule (replace mode) or leaves a partial import behind.
    """
    await assert_member(project_id, current_user, db, allowed_roles={ProjectRole.planner})

    # A bulk import would delete/replace activities that may be frozen under a
    # pending revision — refuse while any are locked.
    await assert_project_not_locked(project_id, db)

    content = await file.read()
    filename = file.filename or ""

    try:
        if filename.endswith((".xlsx", ".xls")):
            df = pd.read_excel(io.BytesIO(content))
        else:
            df = pd.read_csv(io.BytesIO(content))
    except Exception as exc:
        # Don't echo the parser's internal message (it can include file content).
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Could not parse the uploaded file. Provide a valid CSV or Excel file.",
        ) from exc

    # The new schedule export is long-format (one row per readiness gate, with
    # embedded readiness statuses + per-rig contract expiry). It has its own
    # ingestion path; the legacy wide CSV path continues below.
    if is_long_schedule(df):
        return await _import_long_schedule(df, project_id, current_user, db, replace)

    try:
        validate_csv_columns(df)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc

    rows = csv_df_to_db_rows(df, str(project_id))

    # Validate every row against the schema before touching the database.
    validated: list[ActivityCreate] = []
    errors: list[str] = []
    for i, row in enumerate(rows):
        fields = {k: v for k, v in row.items() if k != "project_id"}
        try:
            validated.append(ActivityCreate(**fields))
        except ValidationError as exc:
            for err in exc.errors():
                loc = ".".join(str(p) for p in err["loc"]) or "row"
                errors.append(f"Row {i + 2}: {loc} — {err['msg']}")
    if errors:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "message": "Import rejected — fix the rows below and re-upload.",
                "errors": errors[:20],
            },
        )

    if replace:
        await db.execute(delete(Activity).where(Activity.project_id == project_id))

    for model in validated:
        db.add(
            Activity(
                project_id=project_id,
                updated_by=current_user.id,
                **model.model_dump(),
            )
        )

    await db.commit()
    return ImportResponse(imported=len(validated), replaced=replace)


async def _import_long_schedule(
    df: pd.DataFrame,
    project_id: uuid.UUID,
    current_user: User,
    db: AsyncSession,
    replace: bool,
) -> ImportResponse:
    """Ingest the long-format schedule: collapse the per-gate rows into one activity
    each, import every well's readiness gates, and upsert per-rig contract expiry.

    Validated in full before any write, so a bad row never leaves a partial import
    or deletes the existing schedule. The sheet is the source of truth for readiness
    and contract dates (replace mode resets them to match the file).
    """
    try:
        parsed, contracts = parse_long_schedule(df)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc

    # Validate each collapsed activity (same ActivityCreate gate the JSON API uses)
    # and its readiness gates/statuses. An invalid well is skipped (not imported) and
    # reported; an invalid readiness cell drops just that gate. A structural problem
    # (missing required columns) already raised 422 above.
    validated: list[tuple[ActivityCreate, dict[str, str]]] = []
    skipped_rows: list[dict[str, str]] = []
    warnings: list[str] = []
    for pa in parsed:
        label = pa.fields.get("well_name") or pa.fields.get("activity_type") or "row"
        try:
            activity_in = ActivityCreate(**pa.fields)
        except ValidationError as exc:
            reason = "; ".join(
                f"{'.'.join(str(p) for p in err['loc']) or 'field'} — {err['msg']}"
                for err in exc.errors()
            )
            skipped_rows.append({"well": label, "reason": reason})
            continue
        readiness: dict[str, str] = {}
        for gate, gate_status in pa.readiness.items():
            if gate == "CON" or gate not in CHECK_CODES:
                warnings.append(f"{label}: dropped unknown readiness check '{gate}'")
            elif gate_status not in CHECK_STATUSES:
                warnings.append(f"{label}: dropped {gate} (invalid status '{gate_status}')")
            else:
                readiness[gate] = gate_status
        validated.append((activity_in, readiness))

    # Replace only when at least one well is valid — never wipe the schedule to
    # import nothing (e.g. an entirely-bad file in replace mode).
    if replace and validated:
        # Clear readiness then activities explicitly — don't rely on a DB ON DELETE
        # cascade (SQLite doesn't enforce FKs by default).
        existing_ids = (
            await db.execute(select(Activity.id).where(Activity.project_id == project_id))
        ).scalars().all()
        if existing_ids:
            await db.execute(
                delete(ReadinessCheck).where(ReadinessCheck.activity_id.in_(existing_ids))
            )
        await db.execute(delete(Activity).where(Activity.project_id == project_id))

    for activity_in, readiness in validated:
        activity = Activity(
            id=uuid.uuid4(),  # set up-front so readiness rows can reference it without a flush
            project_id=project_id,
            updated_by=current_user.id,
            **activity_in.model_dump(),
        )
        db.add(activity)
        for gate, gate_status in readiness.items():
            db.add(ReadinessCheck(activity_id=activity.id, check_code=gate, status=gate_status))

    # Rig contract expiry — upsert each rig with a binding (Completed) end date.
    for rig_name, expiry in contracts.items():
        existing = (
            await db.execute(
                select(RigContract).where(
                    RigContract.project_id == project_id,
                    RigContract.rig_name == rig_name,
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            existing.contract_end = expiry
            existing.status = "Completed"
            existing.updated_by = current_user.id
        else:
            db.add(
                RigContract(
                    project_id=project_id,
                    rig_name=rig_name,
                    contract_end=expiry,
                    status="Completed",
                    updated_by=current_user.id,
                )
            )

    await db.commit()
    return ImportResponse(
        imported=len(validated),
        replaced=replace,
        skipped=len(skipped_rows),
        skipped_rows=skipped_rows[:200],
        warnings=warnings[:200],
    )
