import uuid
from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, StringConstraints, field_validator, model_validator

# Canonical oil & gas domain enums. Kept in sync with the frontend selects
# (LOCATIONS / PLAN_TYPES / RISKS) so writes can't introduce free-form variants.
# Responses stay free-form `str` so legacy rows predating these allow-lists still read.
Location = Literal["LAND", "SWAMP", "OFFSHORE"]
PlanType = Literal["Firm", "Option", "Out of Plan"]
Risk = Literal["Flood Risk", "No Flood Risk"]

# A required string that is trimmed and must be non-empty.
NonEmptyStr = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class ActivityCreate(BaseModel):
    activity_type: str
    start_date: date
    end_date: date
    well_name: str | None = None
    rig_name: str | None = None
    hwu_name: str | None = None
    well_project: str | None = None
    project_group: str | None = None
    location: Location | None = None
    risk: Risk | None = None
    comment: str | None = None
    plan_type: PlanType | None = None
    readiness_required: bool = True

    @field_validator("end_date")
    @classmethod
    def end_after_start(cls, v: date, info: object) -> date:
        start = getattr(info, "data", {}).get("start_date")
        if start and v < start:
            raise ValueError("end_date must be on or after start_date")
        return v

    @model_validator(mode="after")
    def _resource_exclusive(self) -> "ActivityCreate":
        # An activity is scheduled on a rig OR an HWU, never both.
        if self.rig_name and self.hwu_name:
            raise ValueError("an activity uses either a rig or an HWU, not both")
        return self


class ActivityCreateStrict(ActivityCreate):
    """Create payload for the JSON API: every descriptive field is mandatory
    except Comment (the resource is governed by the form's "no resource needed"
    opt-out, so it stays optional here). CSV/Excel import keeps using the lenient
    ActivityCreate so partial spreadsheets still load.
    """

    well_name: NonEmptyStr
    location: Location
    risk: Risk
    plan_type: PlanType


class ActivityUpdate(BaseModel):
    activity_type: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    well_name: str | None = None
    rig_name: str | None = None
    hwu_name: str | None = None
    well_project: str | None = None
    project_group: str | None = None
    location: Location | None = None
    risk: Risk | None = None
    comment: str | None = None
    plan_type: PlanType | None = None
    readiness_required: bool | None = None
    # Optimistic lock: client sends back the updated_at it loaded; omit to skip check
    expected_updated_at: datetime | None = None

    @model_validator(mode="after")
    def _required_fields_not_cleared(self) -> "ActivityUpdate":
        # The JSON API treats these as mandatory (only Comment is optional). A
        # PATCH may omit a field (leaves it unchanged) but may not null or blank
        # it. CSV import never uses this schema, so import stays lenient.
        if "well_name" in self.model_fields_set and self.well_name is not None:
            self.well_name = self.well_name.strip()
        for field in (
            "activity_type",
            "start_date",
            "end_date",
            "well_name",
            "location",
            "risk",
            "plan_type",
        ):
            if field in self.model_fields_set and not getattr(self, field):
                raise ValueError(f"{field.replace('_', ' ')} is required and cannot be cleared")
        return self


class ActivityResponse(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    activity_type: str
    start_date: date
    end_date: date
    well_name: str | None
    rig_name: str | None
    hwu_name: str | None
    well_project: str | None
    project_group: str | None
    location: str | None
    risk: str | None
    comment: str | None
    plan_type: str | None
    readiness_required: bool = True
    completed_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    updated_by_name: str | None = None
    locked_by_revision_id: uuid.UUID | None = None

    model_config = {"from_attributes": True}


class SkippedRow(BaseModel):
    well: str
    reason: str


class ImportResponse(BaseModel):
    imported: int
    replaced: bool
    skipped: int = 0
    skipped_rows: list[SkippedRow] = []
    warnings: list[str] = []
