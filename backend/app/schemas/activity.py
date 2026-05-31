import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, field_validator

# Canonical oil & gas domain enums. Kept in sync with the frontend selects
# (LOCATIONS / PLAN_TYPES / RISKS) so writes can't introduce free-form variants.
# Responses stay free-form `str` so legacy rows predating these allow-lists still read.
Location = Literal["LAND", "SWAMP", "OFFSHORE"]
PlanType = Literal["Firm", "Option", "Out of Plan"]
Risk = Literal["Low", "Medium", "High"]


class ActivityCreate(BaseModel):
    activity_type: str
    start_date: date
    end_date: date
    well_name: str | None = None
    rig_name: str | None = None
    project_group: str | None = None
    location: Location | None = None
    risk: Risk | None = None
    comment: str | None = None
    plan_type: PlanType | None = None

    @field_validator("end_date")
    @classmethod
    def end_after_start(cls, v: date, info: object) -> date:
        start = getattr(info, "data", {}).get("start_date")
        if start and v < start:
            raise ValueError("end_date must be on or after start_date")
        return v


class ActivityUpdate(BaseModel):
    activity_type: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    well_name: str | None = None
    rig_name: str | None = None
    project_group: str | None = None
    location: Location | None = None
    risk: Risk | None = None
    comment: str | None = None
    plan_type: PlanType | None = None
    # Optimistic lock: client sends back the updated_at it loaded; omit to skip check
    expected_updated_at: datetime | None = None


class ActivityResponse(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    activity_type: str
    start_date: date
    end_date: date
    well_name: str | None
    rig_name: str | None
    project_group: str | None
    location: str | None
    risk: str | None
    comment: str | None
    plan_type: str | None
    completed_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    updated_by_name: str | None = None
    locked_by_revision_id: uuid.UUID | None = None

    model_config = {"from_attributes": True}


class ImportResponse(BaseModel):
    imported: int
    replaced: bool
