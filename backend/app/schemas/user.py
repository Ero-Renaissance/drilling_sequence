import uuid

from pydantic import BaseModel


class UserResponse(BaseModel):
    id: uuid.UUID
    name: str
    email: str
    is_admin: bool = False
    # Global planner grant — may create campaigns / hold the planner role.
    can_plan: bool = False
    # Readiness teams this user may edit (global team grants) — drives the UI's
    # default lens and which readiness dots are editable. The API stays the authority.
    teams: list[str] = []

    model_config = {"from_attributes": True}
