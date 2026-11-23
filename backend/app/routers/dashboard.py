import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.database import get_db
from app.models.user import User
from app.schemas.dashboard import DashboardResponse
from app.services.dashboard import build_dashboard
from app.services.readiness_rollup import MAX_RANGE_YEARS, valid_year_range

router = APIRouter(prefix="/api/projects/{project_id}/dashboard", tags=["dashboard"])

CurrentUser = Annotated[User, Depends(get_current_user)]
DB = Annotated[AsyncSession, Depends(get_db)]


@router.get("", response_model=DashboardResponse)
async def get_dashboard(
    project_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
    # The readiness YEAR RANGE: 1–3 calendar years from ``readiness_from_year``
    # (default: the server's current year, three years).
    readiness_from_year: int | None = None,
    readiness_years: int = MAX_RANGE_YEARS,
    # Activity-type mix window in months; 0 = the whole plan (historical view).
    mix_horizon_months: int = 0,
) -> DashboardResponse:
    """Read-only KPI summary for the project. Reads are org-wide: any
    authenticated user may view it. No side effects."""
    # Allow-listed horizons only — anything else is refused, never coerced.
    # (A plain int + explicit check because Literal[] won't coerce the query
    # string, and an int Enum obscures the 422 message.)
    if readiness_from_year is None:
        readiness_from_year = date.today().year
    if not valid_year_range(readiness_from_year, readiness_years):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"The readiness range covers 1 to {MAX_RANGE_YEARS} years",
        )
    if mix_horizon_months not in (0, 6, 12, 24):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="mix_horizon_months must be one of 0, 6, 12, 24",
        )
    # Reads are org-wide: any authenticated user may view campaign data.
    return await build_dashboard(
        project_id,
        db,
        readiness_from_year=readiness_from_year,
        readiness_years=readiness_years,
        mix_horizon_months=mix_horizon_months,
    )
