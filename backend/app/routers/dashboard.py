import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.rbac import assert_member
from app.database import get_db
from app.models.user import User
from app.schemas.dashboard import DashboardResponse
from app.services.dashboard import build_dashboard

router = APIRouter(prefix="/api/projects/{project_id}/dashboard", tags=["dashboard"])

CurrentUser = Annotated[User, Depends(get_current_user)]
DB = Annotated[AsyncSession, Depends(get_db)]


@router.get("", response_model=DashboardResponse)
async def get_dashboard(
    project_id: uuid.UUID, current_user: CurrentUser, db: DB
) -> DashboardResponse:
    """Read-only KPI summary for the project. Any project member (incl. viewer) or a
    global admin may read it; non-members get 'Access denied'. No side effects."""
    await assert_member(project_id, current_user, db)
    return await build_dashboard(project_id, db)
