import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr


class ApproverCreate(BaseModel):
    email: EmailStr
    name: str | None = None
    role_label: str = "Approver"


class ApproverResponse(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    email: str
    name: str | None
    role_label: str

    model_config = {"from_attributes": True}


class ApproverSignStatus(BaseModel):
    """Per-approver signing status on a specific revision."""
    email: str
    name: str | None
    role_label: str
    signed: bool
    signed_at: datetime | None
    signer_name: str | None
