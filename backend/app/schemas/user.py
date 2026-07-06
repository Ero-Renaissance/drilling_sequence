import uuid

from pydantic import BaseModel


class UserResponse(BaseModel):
    id: uuid.UUID
    name: str
    email: str
    is_admin: bool = False
    # Global planner grant — may create campaigns / hold the planner role.
    can_plan: bool = False

    model_config = {"from_attributes": True}
