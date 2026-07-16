import uuid
from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, StringConstraints, field_validator, model_validator

from app.services.activity_types import canonicalize_activity_type

# Canonical oil & gas domain enums. Kept in sync with the frontend selects
# (LOCATIONS / PLAN_TYPES / RISKS) so writes can't introduce free-form variants.
# Responses stay free-form `str` so legacy rows predating these allow-lists still read.
Location = Literal["LAND", "SWAMP", "OFFSHORE"]
PlanType = Literal["Firm", "Option", "Out of Plan"]
Risk = Literal["Flood Risk", "No Flood Risk"]
# Market is assigned per field-development PROJECT (one value across its rows —
# the import enforces this); it rides on activities like well_project does.
Market = Literal["Oil", "Domestic Gas", "Export Gas", "Not Applicable"]

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
    market: Market | None = None
    readiness_required: bool = True

    # Normalize the type to its canonical spelling on EVERY write path (this is
    # the base for manual create and the import's ActivityCreate), so a hand-typed
    # "gas development" or "Gas Exploration(Including HPHT)" stores canonically
    # just like an import — no path re-introduces a formatting variant. Idempotent
    # on already-resolved values; an unknown type passes through verbatim.
    @field_validator("activity_type")
    @classmethod
    def _canonicalize_type(cls, v: str) -> str:
        return canonicalize_activity_type(v) or v

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

    # Canonicalize a manual edit's type exactly like create/import (idempotent;
    # None/unknown pass through). See ActivityCreate._canonicalize_type.
    @field_validator("activity_type")
    @classmethod
    def _canonicalize_type(cls, v: str | None) -> str | None:
        return canonicalize_activity_type(v)
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
    market: Market | None = None
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
    market: str | None = None
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


class UnknownActivityType(BaseModel):
    """A distinct sheet value the resolution pipeline could not place — the
    manual mapping step offers these for the planner to map (or keep as-is)."""

    value: str
    rows: int


class AppliedTypeMapping(BaseModel):
    """A word-level rewrite applied at import (curated alias or this upload's
    manual mapping) — reported so an import never silently rewrites the sheet.
    Formatting-only fixes (case/spacing) are not reported; nothing changed."""

    source: str
    target: str
    rows: int


class ImportResponse(BaseModel):
    imported: int
    replaced: bool
    skipped: int = 0
    skipped_rows: list[SkippedRow] = []
    warnings: list[str] = []
    # True = preview (dry run): NOTHING was written; `imported` is the count
    # that would import, and unknown_types feeds the mapping dialog.
    dry_run: bool = False
    unknown_types: list[UnknownActivityType] = []
    applied_mappings: list[AppliedTypeMapping] = []
