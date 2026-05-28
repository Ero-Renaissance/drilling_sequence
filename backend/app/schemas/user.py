import uuid

from pydantic import BaseModel


class UserResponse(BaseModel):
    id: uuid.UUID
    name: str
    email: str
    is_admin: bool = False

    model_config = {"from_attributes": True}
