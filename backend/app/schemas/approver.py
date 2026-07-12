import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field


class ApproverCreate(BaseModel):
    # Bounds mirror the ProjectApprover column widths — overlong values must
    # 422 at validation, not 500 at the database.
    email: EmailStr
    name: str | None = Field(default=None, max_length=256)
    role_label: str = Field(default="Approver", min_length=1, max_length=128)


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
