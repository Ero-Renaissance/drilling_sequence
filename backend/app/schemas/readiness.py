from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, StringConstraints

# Check codes and statuses are no longer fixed enums here: codes come from the
# admin-curated catalog and statuses from each check's code-defined status set
# (app/models/readiness.py). The router validates both against those allow-lists;
# the schema bounds the raw strings.
Status = Annotated[str, StringConstraints(min_length=1, max_length=32)]
Severity = Literal["done", "in_progress", "blocked", "not_counted"]


class CheckState(BaseModel):
    status: str
    notes: str | None = None
    updated_at: datetime | None = None


class CheckUpsert(BaseModel):
    # The field-development project name (Activity.well_project) travels in the
    # BODY, not the URL path: it is free-form user data ("Gbaran 31/30",
    # "Egbema Node FOD + IOGD") and IIS request filtering 404s path segments with
    # '+'/'%2B' before they reach the app (ticket DS-001). Bounds match the
    # String(256) column; matched exactly against stored activity values.
    well_project: Annotated[str, StringConstraints(min_length=1, max_length=256)]
    # Validated against the check's status set in the router (422 otherwise).
    status: Status
    # Bounded to the String(512) column so an over-long note is a 422, not a DB error.
    notes: Annotated[str, StringConstraints(max_length=512)] | None = None


class CheckUpsertResponse(BaseModel):
    well_project: str
    check_code: str
    status: str
    notes: str | None
    updated_at: datetime

    model_config = {"from_attributes": True}


class ProjectReadiness(BaseModel):
    """Readiness for one field-development project (the "Project" column) — the
    seven gates shared by every well/activity under it."""

    well_project: str
    checks: dict[str, CheckState]
    # Count of activities in the campaign that carry this project (context for the
    # grid: "Bonga Phase 3 · 4 activities").
    activity_count: int = 0
    # Frozen while a revision is awaiting approval (the readiness PUT 423s) — lets
    # the grid disable the controls up front, matching the campaign plan lock.
    locked: bool = False
    # Earliest start date of a not-done, readiness-required activity under this
    # field project. Lets the readiness page apply the same focus window the
    # Overview KPI uses — a project is "in the next N months" iff
    # ``focus_start <= today + N``. None when the project has no pending
    # readiness-required work (all done or opt-out): it never falls in a window.
    focus_start: date | None = None


# ── Catalog (GET /api/readiness/catalog) ────────────────────────────────────


class CatalogTeam(BaseModel):
    code: str
    name: str
    editor_source: str
    icon_key: str
    sort_order: int

    model_config = {"from_attributes": True}


class CatalogCheck(BaseModel):
    """A check definition — also the shape frozen into a revision's catalog."""

    code: str
    label: str
    team_code: str
    applies_project: bool
    applies_well: bool
    status_set: str
    icon_key: str
    locks_with_plan: bool
    sort_order: int

    model_config = {"from_attributes": True}


class StatusOption(BaseModel):
    status: str
    severity: Severity


class StatusSet(BaseModel):
    statuses: list[StatusOption]
    default: str


class ReadinessCatalog(BaseModel):
    teams: list[CatalogTeam]
    checks: list[CatalogCheck]
    status_sets: dict[str, StatusSet]
