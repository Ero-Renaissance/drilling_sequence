import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator


class RevisionCommentCreate(BaseModel):
    """A deliberation-thread entry. Same bounds as a decision reason — a
    comment is the same kind of governance text, minus the state change."""

    body: str = Field(min_length=1, max_length=2000)

    @field_validator("body")
    @classmethod
    def _non_blank(cls, v: str) -> str:
        stripped = v.strip()
        if not stripped:
            raise ValueError("A comment can't be blank.")
        return stripped


class RevisionCommentResponse(BaseModel):
    id: uuid.UUID
    revision_id: uuid.UUID
    user_id: uuid.UUID | None
    user_name: str | None
    # Capacity held at post time: "Admin" | "Approver" | "Endorser" | "Planner"
    # (rows predating the Endorse vocabulary read "Reviewer" — kept verbatim).
    author_role: str
    # Revision stage at post time: "review" | "approval"
    stage: str
    body: str
    created_at: datetime

    model_config = {"from_attributes": True}
