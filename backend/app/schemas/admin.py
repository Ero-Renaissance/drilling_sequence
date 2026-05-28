import uuid

from pydantic import BaseModel


class AdminUserResponse(BaseModel):
    id: uuid.UUID
    name: str
    email: str
    is_admin: bool
    project_count: int


class AdminUserUpdate(BaseModel):
    is_admin: bool
