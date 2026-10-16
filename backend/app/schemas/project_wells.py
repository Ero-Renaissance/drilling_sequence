"""Add a field project with its wells in one go (the "Add project" dialog), or
edit an existing one (the same dialog in edit mode).

The planner sets the project once (name, start date, terrain, plan type, risk,
market) and lists its wells — each with its own activity type, rig/HWU and
duration in MONTHS. The server lays the wells out with the rig optimizer's gap
rules (app/services/project_planner.py) and either previews (``dry_run``) or
creates them.

Editing keeps every existing well's dates as they are unless the planner changes
them or asks for a re-sequence; new wells are placed by the same gap rules.
"""
import uuid
from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.schemas.activity import Location, Market, NonEmptyStr, PlanType, Risk, Str256, Str512
from app.services.activity_types import canonicalize_activity_type


def _canonical(v: str) -> str:
    # Same canonical spelling as every other write path (manual create, import).
    return canonicalize_activity_type(v) or v


def _trim_name(v: str | None) -> str | None:
    return v.strip() or None if v is not None else None


def _check_resource(resource_type: str, resource_name: str | None) -> None:
    if resource_type == "none":
        if resource_name:
            raise ValueError("resource_name must be empty when no resource is needed")
    elif not resource_name:
        raise ValueError("Pick a rig or HWU, or choose 'none'")


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
        return _canonical(v)

    @field_validator("resource_name")
    @classmethod
    def _trim(cls, v: str | None) -> str | None:
        return _trim_name(v)

    @model_validator(mode="after")
    def _resource_matches_type(self) -> "PlannedWellIn":
        _check_resource(self.resource_type, self.resource_name)
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
    # "kept": an existing well whose dates were not laid out (edit mode).
    gap_kind: Literal["none", "inter_well", "batch", "project_move", "kept"]


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


# ── Edit an existing project ─────────────────────────────────────────────────


class EditedWellIn(BaseModel):
    """One row of the edit dialog: an existing well (``id`` + the ``updated_at``
    the dialog loaded, with explicit dates) or a new one (no ``id``, a duration
    in months, placed by the gap rules)."""

    model_config = {"extra": "forbid"}

    id: uuid.UUID | None = None
    expected_updated_at: datetime | None = None
    well_name: NonEmptyStr
    activity_type: NonEmptyStr
    resource_type: Literal["rig", "hwu", "none"]
    resource_name: Annotated[Str256, Field(min_length=1)] | None = None
    start_date: date | None = None
    end_date: date | None = None
    duration_months: float | None = Field(default=None, gt=0, le=36)

    @field_validator("activity_type")
    @classmethod
    def _canonical_type(cls, v: str) -> str:
        return _canonical(v)

    @field_validator("resource_name")
    @classmethod
    def _trim(cls, v: str | None) -> str | None:
        return _trim_name(v)

    @model_validator(mode="after")
    def _shape(self) -> "EditedWellIn":
        _check_resource(self.resource_type, self.resource_name)
        if self.id is not None:
            # An existing well: its dates are explicit, and the dialog must say
            # which version it edited (optimistic concurrency).
            if self.expected_updated_at is None:
                raise ValueError("expected_updated_at is required for an existing well")
            if self.start_date is None or self.end_date is None:
                raise ValueError("An existing well needs its start and end dates")
            if self.end_date < self.start_date:
                raise ValueError(f"{self.well_name}: end date must be on or after the start date")
            if self.duration_months is not None:
                raise ValueError("Give an existing well dates, not a duration")
        else:
            if self.duration_months is None:
                raise ValueError(f"{self.well_name}: a new well needs a duration in months")
            if self.start_date is not None or self.end_date is not None:
                raise ValueError("A new well is placed by the gap rules; leave its dates empty")
        return self


class RemovedWellIn(BaseModel):
    model_config = {"extra": "forbid"}

    id: uuid.UUID
    expected_updated_at: datetime


class ProjectWellsEditIn(BaseModel):
    """Edit a field project's wells in one transaction (all or nothing).

    ``well_project`` names the project as the dialog loaded it. The request must
    account for every well the project has — each one is either listed in
    ``wells`` or in ``removed`` — so a well added by someone else meanwhile is
    never silently renamed away from it.

    Project-level fields are optional: a field present in the request is applied
    to every well; an absent one leaves each well's own value ("Mixed").
    """

    model_config = {"extra": "forbid"}

    well_project: NonEmptyStr
    new_name: NonEmptyStr | None = None
    location: Location | None = None
    plan_type: PlanType | None = None
    risk: Risk | None = None
    market: Market | None = None
    readiness_required: bool | None = None
    wells: list[EditedWellIn] = Field(min_length=1, max_length=100)
    removed: list[RemovedWellIn] = Field(default_factory=list, max_length=100)
    # "keep": existing wells keep their dates; new wells chain after the
    # project's wells on their rig. "resequence": lay every open well out again,
    # in list order, from ``start_date`` with the gap rules (durations kept).
    layout: Literal["keep", "resequence"] = "keep"
    start_date: date | None = None
    dry_run: bool = True

    @model_validator(mode="after")
    def _consistent(self) -> "ProjectWellsEditIn":
        # Required descriptors may be left out ("Mixed") but never cleared.
        for field in ("location", "plan_type", "risk", "readiness_required"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field.replace('_', ' ')} cannot be cleared")
        if self.layout == "resequence" and self.start_date is None:
            raise ValueError("A re-sequence needs a start date")
        ids = [w.id for w in self.wells if w.id is not None] + [r.id for r in self.removed]
        if len(ids) != len(set(ids)):
            raise ValueError("A well is listed more than once")
        # Duplicate well + activity keys are checked against the loaded wells in
        # plan_project_edit: activities that already share a key may keep it.
        return self


class EditedWellOut(PlannedWellOut):
    id: uuid.UUID | None
    change: Literal["new", "changed", "unchanged"]
    completed: bool = False


class RemovedWellOut(BaseModel):
    id: uuid.UUID
    well_name: str | None
    activity_type: str


class ProjectWellsEditPlan(BaseModel):
    well_project: str
    wells: list[EditedWellOut]
    removed: list[RemovedWellOut]
    conflicts: list[PlanConflict]
    saved: bool = False
