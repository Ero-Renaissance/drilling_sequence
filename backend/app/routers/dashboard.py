import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.database import get_db
from app.models.user import User
from app.schemas.dashboard import DashboardResponse
from app.services.dashboard import build_dashboard

router = APIRouter(prefix="/api/projects/{project_id}/dashboard", tags=["dashboard"])

CurrentUser = Annotated[User, Depends(get_current_user)]
DB = Annotated[AsyncSession, Depends(get_db)]


@router.get("", response_model=DashboardResponse)
async def get_dashboard(
    project_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
    # Readiness focus window in months; 0 = all projects.
    readiness_horizon_months: int = 12,
    # Activity-type mix window in months; 0 = the whole plan (historical view).
    mix_horizon_months: int = 0,
) -> DashboardResponse:
    """Read-only KPI summary for the project. Reads are org-wide: any
    authenticated user may view it. No side effects."""
    # Allow-listed horizons only — anything else is refused, never coerced.
    # (A plain int + explicit check because Literal[] won't coerce the query
    # string, and an int Enum obscures the 422 message.)
    if readiness_horizon_months not in (0, 6, 12, 24):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="readiness_horizon_months must be one of 0, 6, 12, 24",
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
        readiness_horizon_months=readiness_horizon_months,
        mix_horizon_months=mix_horizon_months,
    )
