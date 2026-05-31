import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.rbac import assert_member
from app.database import get_db
from app.models.user import User
from app.models.viewer import ProjectViewer
from app.schemas.viewer import ViewerResponse

router = APIRouter(prefix="/api/projects/{project_id}/viewers", tags=["viewers"])

CurrentUser = Annotated[User, Depends(get_current_user)]
DB = Annotated[AsyncSession, Depends(get_db)]

PRESENCE_TTL_MINUTES = 5


@router.get("", response_model=list[ViewerResponse])
async def get_viewers(
    project_id: uuid.UUID, current_user: CurrentUser, db: DB
) -> list[ViewerResponse]:
    """Record this user's presence and return all active viewers (last 5 min)."""
    await assert_member(project_id, current_user, db)

    now = datetime.now(timezone.utc)

    # Upsert current user's last_seen_at
    existing = await db.execute(
        select(ProjectViewer).where(
            ProjectViewer.project_id == project_id,
            ProjectViewer.user_id == current_user.id,
        )
    )
    viewer = existing.scalar_one_or_none()
    if viewer is None:
        viewer = ProjectViewer(
            project_id=project_id,
            user_id=current_user.id,
            last_seen_at=now,
        )
        db.add(viewer)
    else:
        viewer.last_seen_at = now

    await db.commit()

    # Return all viewers active in the last TTL window
    cutoff = now - timedelta(minutes=PRESENCE_TTL_MINUTES)
    result = await db.execute(
        select(ProjectViewer)
        .where(
            ProjectViewer.project_id == project_id,
            ProjectViewer.last_seen_at >= cutoff,
        )
        .order_by(ProjectViewer.last_seen_at.desc())
    )
    viewers = result.scalars().all()

    return [
        ViewerResponse(
            user_id=v.user_id,
            user_name=v.user.name,
            last_seen_at=v.last_seen_at,
        )
        for v in viewers
    ]
