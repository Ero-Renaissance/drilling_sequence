"""Add a field project with its wells in one go (the "Add project" dialog).

The planner sets the project once (name, start date, terrain, plan type, risk,
market) and lists its wells — each with its own activity type, rig/HWU and
duration in MONTHS. The server lays the wells out with the rig optimizer's gap
rules (app/services/project_planner.py) and either previews (``dry_run``) or
creates them.
"""
from datetime import date
from typing import Annotated, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.schemas.activity import Location, Market, NonEmptyStr, PlanType, Risk, Str256, Str512
from app.services.activity_types import canonicalize_activity_type


class PlannedWellIn(BaseModel):
    model_config = {"extra": "forbid"}

    well_name: NonEmptyStr
    activity_type: NonEmptyStr
    resource_type: Literal["rig", "hwu", "none"]
    resource_name: Annotated[Str256, Field(min_length=1)] | None = None
    # Rig time in months (decimals allowed, e.g. 2.5) — converted at the
    # optimizer's 30.44 days/month.
    duration_months: float = Field(gt=0, le=36)

    @field_validator("activity_type")
    @classmethod
    def _canonical_type(cls, v: str) -> str:
        # Same canonical spelling as every other write path (manual create, import).
        return canonicalize_activity_type(v) or v

    @field_validator("resource_name")
    @classmethod
    def _trim(cls, v: str | None) -> str | None:
        return v.strip() or None if v is not None else None

    @model_validator(mode="after")
    def _resource_matches_type(self) -> "PlannedWellIn":
        if self.resource_type == "none":
            if self.resource_name:
                raise ValueError("resource_name must be empty when no resource is needed")
        elif not self.resource_name:
            raise ValueError("Pick a rig or HWU, or choose 'none'")
        return self


class ProjectWellsIn(BaseModel):
    model_config = {"extra": "forbid"}

    well_project: NonEmptyStr
    # The earliest any well may start; each rig's chain starts here (or once the
    # rig frees up from its current job).
    start_date: date
    location: Location
    plan_type: PlanType
    risk: Risk
    market: Market | None = None
    readiness_required: bool = True
    comment: Str512 | None = None
    wells: list[PlannedWellIn] = Field(min_length=1, max_length=50)
    # True → only compute and return the plan; False → create the activities.
    dry_run: bool = True

    @model_validator(mode="after")
    def _distinct_wells(self) -> "ProjectWellsIn":
        # Two rows with the same well AND activity type would share one readiness
        # key (spec §7.2) — almost certainly a typo in a bulk entry, so refuse it.
        seen: set[tuple[str, str]] = set()
        for w in self.wells:
            key = (w.well_name, w.activity_type)
            if key in seen:
                raise ValueError(
                    f"{w.well_name} is listed twice with activity {w.activity_type}"
                )
            seen.add(key)
        return self


class PlannedWellOut(BaseModel):
    well_name: str
    activity_type: str
    rig_name: str | None
    hwu_name: str | None
    start_date: date
    end_date: date
    duration_days: int
    gap_before_days: int
    gap_kind: Literal["none", "inter_well", "batch", "project_move"]


class PlanConflict(BaseModel):
    well_name: str
    resource: str
    clashes_with: str
    overlap_days: int


class ProjectWellsPlan(BaseModel):
    wells: list[PlannedWellOut]
    # Overlaps with work already on the same rig/HWU (or between the new wells)
    # that the gap rules couldn't avoid — shown before anything is created.
    conflicts: list[PlanConflict]
    created: int = 0
