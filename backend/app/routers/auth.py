from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.database import get_db
from app.models.readiness import UserTeamGrant
from app.models.user import User
from app.schemas.user import UserResponse

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/me", response_model=UserResponse)
async def get_me(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> UserResponse:
    """Return the authenticated user's profile, with their readiness team grants."""
    teams = (
        await db.execute(
            select(UserTeamGrant.team_code)
            .where(UserTeamGrant.user_id == current_user.id)
            .order_by(UserTeamGrant.team_code)
        )
    ).scalars().all()
    response = UserResponse.model_validate(current_user)
    response.teams = list(teams)
    return response
