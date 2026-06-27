from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


class ChangeNoteUpsert(BaseModel):
    kind: Literal["rig", "hwu", "general"]
    resource_name: str | None = None
    # An empty body deletes the note (a resource with nothing to say drops out).
    body: str = Field(max_length=4000)

    @field_validator("resource_name")
    @classmethod
    def _strip(cls, value: str | None) -> str | None:
        return value.strip() if value else value

    @model_validator(mode="after")
    def _resource_matches_kind(self) -> "ChangeNoteUpsert":
        if self.kind in ("rig", "hwu") and not self.resource_name:
            raise ValueError("resource_name is required for rig/hwu notes")
        if self.kind == "general":
            self.resource_name = None
        return self


class ChangeNoteResponse(BaseModel):
    kind: str
    resource_name: str | None
    body: str
    updated_at: datetime

    model_config = {"from_attributes": True}
