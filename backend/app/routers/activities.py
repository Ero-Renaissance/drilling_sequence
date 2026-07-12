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
from app.models.hwu_contract import HwuContract
from app.models.project import Project, ProjectRole
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
    CANONICAL_ACTIVITY_TYPES,
    cross_terrain_resource_warnings,
    csv_df_to_db_rows,
    is_long_schedule,
    parse_long_schedule,
    unknown_activity_type_warnings,
    validate_csv_columns,
)
from app.services.registry import (
    ensure_activity_resources_registered,
    ensure_registered,
    lane_contract_rows,
)

router = APIRouter(prefix="/api/projects/{project_id}/activities", tags=["activities"])

# Import upload bounds. Real campaign sheets are a few hundred KB / a few
# thousand rows (7 rows per well); the caps only exist to stop a huge or
# decompression-bomb upload from exhausting memory. Mirrors the optimizer's
# _MAX_UPLOAD_BYTES pattern (app/routers/optimizer.py).
MAX_IMPORT_BYTES = 5 * 1024 * 1024
MAX_IMPORT_ROWS = 20_000

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
    # Reads are org-wide: any authenticated user may view campaign data.
    result = await db.execute(
        select(Activity)
        .where(Activity.project_id == project_id)
        .order_by(Activity.start_date)
    )
    return [ActivityResponse.model_validate(a) for a in result.scalars().all()]


# Terrain row order on every Gantt: Land → Swamp → Offshore (unknown sorts last).
_TERRAIN_ORDER = {"LAND": 0, "SWAMP": 1, "OFFSHORE": 2}


@router.get("/export")
async def export_activities(project_id: uuid.UUID, current_user: CurrentUser, db: DB):
    """Export the full campaign plan (every activity) as an Excel workbook —
    the rig sequence as a table, sorted to mirror the chart (terrain → resource
    → start). Read-only, so any authenticated user may download it. Readiness
    checks are intentionally excluded."""
    from fastapi.responses import StreamingResponse

    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    rows = (
        await db.execute(select(Activity).where(Activity.project_id == project_id))
    ).scalars().all()

    def _sort_key(a: Activity) -> tuple:
        resource = a.hwu_name or a.rig_name or ""
        return (_TERRAIN_ORDER.get((a.location or "").upper(), 99), resource, a.start_date)

    rows = sorted(rows, key=_sort_key)

    from openpyxl import Workbook  # already a vetted dependency (Excel import)
    from openpyxl.styles import Font

    wb = Workbook()
    ws = wb.active
    ws.title = "Rig Sequence"
    headers = [
        "Location", "Resource Type", "Resource Name", "Well", "Project",
        "Activity Type", "Plan Type", "Risk", "Start", "End",
        "Duration (days)", "Comment", "Completed",
    ]
    ws.append(headers)
    for cell in ws[1]:
        cell.font = Font(bold=True)

    date_fmt = "DD-MM-YYYY"
    for a in rows:
        resource_type = "HWU" if a.hwu_name else ("Rig" if a.rig_name else "")
        duration = (a.end_date - a.start_date).days if a.start_date and a.end_date else None
        completed = a.completed_at.date() if a.completed_at else None
        ws.append(
            [
                a.location, resource_type, a.hwu_name or a.rig_name, a.well_name,
                a.well_project, a.activity_type, a.plan_type, a.risk,
                a.start_date, a.end_date, duration, a.comment, completed,
            ]
        )
        r = ws.max_row
        ws.cell(row=r, column=9).number_format = date_fmt   # Start
        ws.cell(row=r, column=10).number_format = date_fmt  # End
        if completed is not None:
            ws.cell(row=r, column=13).number_format = date_fmt

    for col in ws.columns:
        width = max((len(str(c.value)) for c in col if c.value is not None), default=10)
        ws.column_dimensions[col[0].column_letter].width = min(width + 2, 45)

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    safe = "".join(c for c in project.name if c.isalnum() or c in " -_").strip() or "campaign"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{safe} - rig sequence.xlsx"'},
    )


@router.get("/import-template")
async def download_import_template(project_id: uuid.UUID, current_user: CurrentUser):
    """A blank, self-documenting Excel template for the long-format import.

    Static content (no project data), so any authenticated user may download it.
    Sheet 1 "Schedule": header + three sample wells — including a LAND and a
    SWAMP rig SHARING A NAME, demonstrating the identity convention (two
    physical rigs) — with Excel dropdowns on every enum column so wrong values
    are hard to type. Sheet 2 "Guidance": the rules and canonical vocabularies
    (which also feed the activity-type dropdown via a defined name).
    """
    from datetime import date as _date

    from fastapi.responses import StreamingResponse
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font
    from openpyxl.workbook.defined_name import DefinedName
    from openpyxl.worksheet.datavalidation import DataValidation

    header = [
        "Location", "Rig Name", "HWU Name", "Activity Type", "Plan Type", "Project",
        "Well Name", "Start Date", "End Date", "Rig Contract Expiry Date",
        "HWU Contract Expiry Date", "Risk", "Readiness Check", "Readiness Check Status",
        "Comment",
    ]
    gates = list(CHECK_CODES)  # FDP, LLI, LOC, FE, FID, EIA, BUD

    def well_rows(
        *, loc, rig, hwu, atype, plan, project, well,
        start, end, rig_exp=None, hwu_exp=None, risk, statuses=None, comment="",
    ):
        statuses = statuses or {}
        return [
            [
                loc, rig, hwu, atype, plan, project, well, start, end,
                rig_exp, hwu_exp, risk, g, statuses.get(g, "On Track"),
                comment if i == 0 else "",
            ]
            for i, g in enumerate(gates)
        ]

    samples = [
        *well_rows(
            loc="LAND", rig="Rig 1", hwu=None, atype="Gas Development",
            plan="In Plan (Firm)", project="Project Alpha", well="Well-1",
            start=_date(2026, 1, 15), end=_date(2026, 6, 30),
            rig_exp=_date(2030, 12, 31), risk="No Flood Risk",
            statuses={"FDP": "Completed", "LOC": "Behind", "EIA": "N/A", "BUD": "Completed"},
            comment="One well = one block of 7 rows (one per readiness gate)",
        ),
        *well_rows(
            loc="SWAMP", rig="Rig 1", hwu=None, atype="Oil Development",
            plan="In Plan (Option)", project="Project Alpha", well="Well-2",
            start=_date(2026, 3, 1), end=_date(2026, 8, 31),
            rig_exp=_date(2031, 6, 30), risk="Flood Risk",
            comment="Same name as the LAND rig = a DIFFERENT physical rig (see Guidance)",
        ),
        *well_rows(
            loc="SWAMP", rig=None, hwu="HWU 1", atype="Well Repair/Safety",
            plan="In Plan (Firm)", project="Project Alpha", well="Well-3",
            start=_date(2026, 9, 1), end=_date(2026, 11, 30),
            hwu_exp=_date(2031, 6, 30), risk="No Flood Risk",
            comment="A row uses a rig OR an HWU, never both",
        ),
    ]

    wb = Workbook()
    ws = wb.active
    ws.title = "Schedule"
    ws.append(header)
    for cell in ws[1]:
        cell.font = Font(bold=True)
    for row in samples:
        ws.append(row)
    date_cols = (8, 9, 10, 11)  # Start, End, both expiry columns
    for r in range(2, ws.max_row + 1):
        for c in date_cols:
            ws.cell(row=r, column=c).number_format = "DD/MM/YYYY"
    for col in ws.columns:
        width = max((len(str(c.value)) for c in col if c.value is not None), default=10)
        ws.column_dimensions[col[0].column_letter].width = min(width + 2, 42)

    # ── Guidance sheet: the rules + the canonical vocabularies ────────────────
    gd = wb.create_sheet("Guidance")
    gd.append(["Rule", "Guidance"])
    for cell in gd[1]:
        cell.font = Font(bold=True)
    rules = [
        ("One well per block", "Each well is ONE block of 7 rows — one row per readiness "
         "gate (FDP, LLI, LOC, FE, FID, EIA, BUD). Never put several wells in one cell."),
        ("Rig identity", "A rig is identified by Location + Rig Name. The same name in two "
         "locations is TWO physical rigs (e.g. a land 10K and a swamp 10K barge) — the import "
         "confirms this with an informational notice. Two rigs of the same class in the SAME "
         "location must be numbered (10K Rig 1, 10K Rig 2)."),
        ("Planned rigs", "Don't know the awarded rig yet? Use a class-style slot name "
         "(e.g. '10K Rig 3'). It registers as a PLANNED unit (no awarded rig behind it); rename "
         "it from the Fleet page when the contract is awarded — its schedule and contract "
         "follow automatically."),
        ("HWUs", "HWUs are mobile units: the same HWU Name anywhere is ONE unit, whatever "
         "the location."),
        ("Dates", "Day-first — DD/MM/YYYY or DD-MM-YYYY (e.g. 31/07/2026). Real Excel date "
         "cells work too. A month-first or impossible date rejects the whole upload."),
        ("Activity Type", "Use the exact canonical names in column D — anything else imports "
         "but charts in neutral grey until an admin adds it to the catalogue."),
        ("Readiness Check Status", "On Track, Completed, Behind or N/A. Also accepted and "
         "mapped: 'Behind Schedule' → Behind; 'Not Started' / 'In Progress' → On Track."),
        ("Rig Contract Expiry Date", "ONE date per physical rig, repeated identically on its "
         "rows (the last row wins). Terrain twins may each carry their own date. Leave blank "
         "when there is no contract yet — correct for planned units; the dashboard then raises "
         "a procurement alert. Never a computed date (e.g. end + 24 months)."),
        ("Plan Type", "In Plan (Firm), In Plan (Option) or Out of Plan."),
        ("Risk", "Flood Risk or No Flood Risk."),
    ]
    for rule in rules:
        gd.append(list(rule))
    gd.column_dimensions["A"].width = 26
    gd.column_dimensions["B"].width = 110
    for r in range(2, gd.max_row + 1):
        gd.cell(row=r, column=2).alignment = Alignment(wrap_text=True, vertical="top")

    # Canonical activity types — listed for the planner AND feeding the dropdown.
    gd.cell(row=1, column=4, value="Canonical Activity Types").font = Font(bold=True)
    types = sorted(CANONICAL_ACTIVITY_TYPES)
    for i, t in enumerate(types, start=2):
        gd.cell(row=i, column=4, value=t)
    gd.column_dimensions["D"].width = 34
    wb.defined_names["ActivityTypes"] = DefinedName(
        "ActivityTypes", attr_text=f"Guidance!$D$2:$D${1 + len(types)}"
    )

    # ── Dropdowns on the Schedule sheet's enum columns ─────────────────────────
    def dropdown(formula: str, cells: str) -> None:
        dv = DataValidation(type="list", formula1=formula, allow_blank=True)
        ws.add_data_validation(dv)
        dv.add(cells)

    last = 2000  # generous editing room
    dropdown('"LAND,SWAMP,OFFSHORE"', f"A2:A{last}")
    dropdown("ActivityTypes", f"D2:D{last}")
    dropdown('"In Plan (Firm),In Plan (Option),Out of Plan"', f"E2:E{last}")
    dropdown('"Flood Risk,No Flood Risk"', f"L2:L{last}")
    dropdown(f'"{",".join(gates)}"', f"M2:M{last}")
    dropdown('"On Track,Completed,Behind,N/A"', f"N2:N{last}")

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="schedule-import-template.xlsx"'},
    )


@router.post("", response_model=ActivityResponse, status_code=status.HTTP_201_CREATED)
async def create_activity(
    project_id: uuid.UUID, payload: ActivityCreateStrict, current_user: CurrentUser, db: DB
) -> ActivityResponse:
    await assert_member(project_id, current_user, db, allowed_roles={ProjectRole.planner})
    # Adding an activity mutates the plan, so it is barred while a revision is
    # awaiting approval — the same gate as import (which also creates activities),
    # consistent with the update/complete/delete locks on existing activities.
    await assert_project_not_locked(project_id, db)
    activity = Activity(project_id=project_id, updated_by=current_user.id, **payload.model_dump())
    db.add(activity)
    # Register the physical unit as a side effect (planner types name + location,
    # exactly the spreadsheet habit) — new units start as placeholder slots.
    if payload.rig_name:
        await ensure_registered(
            db, project_id, kind="rig", name=payload.rig_name,
            location=payload.location, user_id=current_user.id,
        )
    elif payload.hwu_name:
        await ensure_registered(
            db, project_id, kind="hwu", name=payload.hwu_name,
            location=None, user_id=current_user.id,
        )
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
    # Register the (possibly re-pointed) unit — no-op when it already exists.
    if activity.rig_name:
        await ensure_registered(
            db, project_id, kind="rig", name=activity.rig_name,
            location=activity.location, user_id=current_user.id,
        )
    elif activity.hwu_name:
        await ensure_registered(
            db, project_id, kind="hwu", name=activity.hwu_name,
            location=None, user_id=current_user.id,
        )
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
    # Reads are org-wide: any authenticated user may view campaign data.
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

    # Cap what we materialize BEFORE parsing (read one byte past the limit so
    # an at-limit file passes and an over-limit one is detected without
    # buffering the rest). Real schedules are well under 1 MB; the cap exists
    # so a huge or decompression-bomb upload can't exhaust server memory.
    content = await file.read(MAX_IMPORT_BYTES + 1)
    if len(content) > MAX_IMPORT_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=(
                f"File is larger than the {MAX_IMPORT_BYTES // (1024 * 1024)} MB "
                f"import limit. Split the schedule or remove unrelated sheets."
            ),
        )
    filename = file.filename or ""

    # keep_default_na=False + na_values=[""]: only genuinely EMPTY cells read as
    # missing. Pandas' default NA list would turn the literal readiness status
    # "N/A" into NaN — silently importing it as "On Track" (a real bug caught by
    # the template round-trip test).
    _na = {"keep_default_na": False, "na_values": [""]}
    try:
        if filename.endswith((".xlsx", ".xls")):
            df = pd.read_excel(io.BytesIO(content), **_na)
        else:
            df = pd.read_csv(io.BytesIO(content), **_na)
    except Exception as exc:
        # Don't echo the parser's internal message (it can include file content).
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Could not parse the uploaded file. Provide a valid CSV or Excel file.",
        ) from exc

    # Row ceiling: the byte cap alone can't bound a compressed .xlsx, which can
    # expand far past its file size when parsed.
    if len(df) > MAX_IMPORT_ROWS:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=(
                f"The sheet has {len(df)} rows — more than the {MAX_IMPORT_ROWS} "
                f"the import accepts. Split the schedule into smaller files."
            ),
        )

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

    await ensure_activity_resources_registered(
        db, project_id, _resource_triples(validated), current_user.id
    )
    await db.commit()
    return ImportResponse(
        imported=len(validated),
        replaced=replace,
        warnings=unknown_activity_type_warnings([m.activity_type for m in validated])[:200],
    )


def _resource_triples(models: list[ActivityCreate]) -> set[tuple[str, str, str | None]]:
    """Distinct physical units referenced by a batch of activities — rigs keyed
    with their terrain, HWUs without (they are mobile; see services/registry.py)."""
    triples: set[tuple[str, str, str | None]] = set()
    for m in models:
        if m.rig_name:
            triples.add(("rig", m.rig_name, m.location))
        elif m.hwu_name:
            triples.add(("hwu", m.hwu_name, None))
    return triples


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
        parsed, rig_contracts, hwu_contracts = parse_long_schedule(df)
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
            if gate not in CHECK_CODES:
                warnings.append(f"{label}: dropped unknown readiness check '{gate}'")
            elif gate_status not in CHECK_STATUSES:
                warnings.append(f"{label}: dropped {gate} (invalid status '{gate_status}')")
            else:
                readiness[gate] = gate_status
        validated.append((activity_in, readiness))

    # Non-canonical activity types import fine but chart in neutral grey — tell
    # the planner so the vocabulary gets fixed (or the catalogue extended).
    warnings.extend(
        unknown_activity_type_warnings([a.activity_type for a, _ in validated])
    )
    # A RIG name spanning terrains is legal (two physical units under the
    # planner's naming convention) but can also hide a location typo — warn.
    # HWUs are exempt: they are mobile, so cross-terrain use is unremarkable.
    warnings.extend(
        cross_terrain_resource_warnings([(a.rig_name, a.location) for a, _ in validated], "Rig")
    )

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

    # Register every physical unit the sheet references (rigs terrain-qualified,
    # HWUs by name) — new units start as placeholder slots.
    await ensure_activity_resources_registered(
        db, project_id, _resource_triples([a for a, _ in validated]), current_user.id
    )

    # Resource contract expiry — upsert each rig / HWU end date, so an imported
    # sheet sets the contract exactly like the editor (it drives the
    # contract-expiry marker). Rig contracts are per PHYSICAL unit: keyed
    # (name, terrain), so a LAND and SWAMP rig sharing a name stay separate.
    # Rows are matched like the registry — trimmed, case-insensitively — so a
    # sheet whose casing drifted from an earlier save updates the SAME unit's
    # row instead of splitting it; legacy case-variant duplicates all get the
    # new expiry (kept consistent, never guessed between).
    for (rig_name, terrain), expiry in rig_contracts.items():
        existing_rows = await lane_contract_rows(
            db, project_id, kind="rig", name=rig_name, terrain=terrain
        )
        if existing_rows:
            for existing in existing_rows:
                existing.contract_end = expiry
                existing.updated_by = current_user.id
        else:
            db.add(
                RigContract(
                    project_id=project_id,
                    rig_name=rig_name,
                    terrain=terrain,
                    contract_end=expiry,
                    updated_by=current_user.id,
                )
            )

    for hwu_name, expiry in hwu_contracts.items():
        existing_hwu_rows = await lane_contract_rows(
            db, project_id, kind="hwu", name=hwu_name
        )
        if existing_hwu_rows:
            for existing_hwu in existing_hwu_rows:
                existing_hwu.contract_end = expiry
                existing_hwu.updated_by = current_user.id
        else:
            db.add(
                HwuContract(
                    project_id=project_id,
                    hwu_name=hwu_name,
                    contract_end=expiry,
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
