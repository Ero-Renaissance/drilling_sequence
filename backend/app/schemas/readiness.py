from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints, field_validator, model_validator

from app.models.readiness import ICON_KEYS, STATUS_SETS, TAG_LISTS

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
    # Tag codes on this entry (checks with a tag list, e.g. Nominated Equipment).
    tags: list[str] = []


Name = Annotated[str, StringConstraints(min_length=1, max_length=256)]
TagCode = Annotated[str, StringConstraints(pattern=r"^[A-Z][A-Z0-9-]{1,15}$")]


class WellTarget(BaseModel):
    """Which readiness target a write addresses. All names travel in the BODY,
    never the URL path: they are free-form user data ("Gbaran 31/30",
    "Egbema Node FOD + IOGD") and IIS request filtering 404s path segments with
    '+'/'%2B' before they reach the app (ticket DS-001). Bounds match the
    String(256) columns; names are matched exactly against stored activity values.

    - ``scope="project"``: a field project — ``well_project`` required, no well
      fields.
    - ``scope="well"``: one well activity — ``well_name`` + ``activity_type``
      required; ``well_project`` may be "" for a well with no field project.
    """

    scope: Literal["project", "well"] = "project"
    well_project: Annotated[str, StringConstraints(max_length=256)]
    well_name: Name | None = None
    activity_type: Name | None = None

    @model_validator(mode="after")
    def _target_matches_scope(self) -> "WellTarget":
        if self.scope == "project":
            if not self.well_project:
                raise ValueError("well_project is required for a field-project check")
            if self.well_name is not None or self.activity_type is not None:
                raise ValueError("well_name/activity_type apply to well-level checks only")
        elif self.well_name is None or self.activity_type is None:
            raise ValueError("well_name and activity_type are required for a well-level check")
        return self


class CheckUpsert(WellTarget):
    # Validated against the check's status set in the router (422 otherwise).
    status: Status
    # Bounded to the String(512) column so an over-long note is a 422, not a DB error.
    notes: Annotated[str, StringConstraints(max_length=512)] | None = None
    # Only for checks with a tag list: the entry's OWN tags, each an active item of
    # that list (router-validated). None = leave unchanged; [] = clear.
    tags: list[TagCode] | None = Field(default=None, max_length=50)


class CheckUpsertResponse(BaseModel):
    scope: str = "project"
    well_project: str
    well_name: str = ""
    activity_type: str = ""
    check_code: str
    status: str
    notes: str | None
    updated_at: datetime
    tags: list[str] = []

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
    # "" = none; else the controlled tag list the check carries ("equipment").
    tag_list: str = ""

    model_config = {"from_attributes": True}


class TagItem(BaseModel):
    """One item of a controlled tag list (e.g. an equipment type)."""

    tag_list: str
    code: str
    label: str
    category: str
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
    # Active items of every tag list (for the Nominated Equipment picker).
    tag_items: list[TagItem] = []


# ── Team lens (GET /readiness/teams/{team_code}) ────────────────────────────


class EffectiveCheckState(CheckState):
    """A check's value as a well sees it: its own entry ("well"), else the field
    project's ("project" — inherited, for checks that apply at both levels or
    only at project level), else the status set's default ("default")."""

    source: Literal["well", "project", "default"]
    # The field project's tags this well inherits (two-level checks with a tag
    # list); the well's effective tags are inherited_tags ∪ tags.
    inherited_tags: list[str] = []


class TeamProjectRow(BaseModel):
    well_project: str
    activity_count: int
    checks: dict[str, CheckState]  # the team's project-level checks only


class TeamWellRow(BaseModel):
    well_project: str  # "" = a well with no field project
    well_name: str
    activity_type: str
    # >1 means several activities share this project + well + activity type
    # (e.g. two workovers) and therefore share its readiness — the UI warns.
    activity_count: int
    location: str | None = None
    start_date: date
    # Earliest start of a not-done, readiness-required activity (None: no pending
    # readiness work) — the same focus signal the project gates page uses.
    focus_start: date | None = None
    checks: dict[str, EffectiveCheckState]  # every team check, effective value


class TeamReadiness(BaseModel):
    team: CatalogTeam
    checks: list[CatalogCheck]
    project_rows: list[TeamProjectRow]
    well_rows: list[TeamWellRow]
    # The plan lock — only checks that lock with the plan are frozen by it.
    locked: bool


# ── Admin: catalog management + team grants ─────────────────────────────────
# extra="forbid": immutable fields (a check's code, team, status set, scope,
# lock behaviour) sent on a PATCH are a 422, never silently ignored.

TeamCode = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9-]{1,31}$")]
CheckCodeStr = Annotated[str, StringConstraints(pattern=r"^[A-Z][A-Z0-9-]{1,7}$")]
Label = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)]
SortOrder = Annotated[int, Field(ge=0, le=10_000)]


def _check_icon_key(value: str | None) -> str | None:
    if value is not None and value not in ICON_KEYS:
        raise ValueError("Unknown icon")
    return value


class TeamCreate(BaseModel):
    model_config = {"extra": "forbid"}

    code: TeamCode
    name: Label
    icon_key: str
    sort_order: SortOrder = 100

    _icon = field_validator("icon_key")(_check_icon_key)


class TeamUpdate(BaseModel):
    model_config = {"extra": "forbid"}

    name: Label | None = None
    icon_key: str | None = None
    sort_order: SortOrder | None = None
    is_active: bool | None = None

    _icon = field_validator("icon_key")(_check_icon_key)

    @model_validator(mode="after")
    def _at_least_one(self) -> "TeamUpdate":
        if all(v is None for v in (self.name, self.icon_key, self.sort_order, self.is_active)):
            raise ValueError("Provide at least one field to change")
        return self


class CheckCreate(BaseModel):
    model_config = {"extra": "forbid"}

    code: CheckCodeStr
    label: Label
    team_code: TeamCode
    applies_project: bool
    applies_well: bool
    status_set: str
    icon_key: str
    locks_with_plan: bool
    sort_order: SortOrder = 100
    # "" or a code-defined tag list (TAG_LISTS).
    tag_list: str = ""

    _icon = field_validator("icon_key")(_check_icon_key)

    @field_validator("tag_list")
    @classmethod
    def _known_tag_list(cls, value: str) -> str:
        if value and value not in TAG_LISTS:
            raise ValueError("Unknown tag list")
        return value

    @field_validator("status_set")
    @classmethod
    def _known_status_set(cls, value: str) -> str:
        if value not in STATUS_SETS:
            raise ValueError("Unknown status set")
        return value

    @model_validator(mode="after")
    def _scope_rules(self) -> "CheckCreate":
        if not (self.applies_project or self.applies_well):
            raise ValueError("A check must apply at project level, well level, or both")
        # Governed checks are frozen into the snapshot's field-project readiness
        # block — they exist only at field-project level (spec §3.2).
        if self.locks_with_plan and (self.applies_well or not self.applies_project):
            raise ValueError("A check that locks with the plan applies at project level only")
        return self


class CheckUpdate(BaseModel):
    model_config = {"extra": "forbid"}

    label: Label | None = None
    icon_key: str | None = None
    sort_order: SortOrder | None = None

    _icon = field_validator("icon_key")(_check_icon_key)

    @model_validator(mode="after")
    def _at_least_one(self) -> "CheckUpdate":
        if all(v is None for v in (self.label, self.icon_key, self.sort_order)):
            raise ValueError("Provide at least one field to change")
        return self


class AdminCatalogTeam(CatalogTeam):
    is_active: bool


class AdminCatalogCheck(CatalogCheck):
    retired_at: datetime | None


class AdminTagItem(TagItem):
    retired_at: datetime | None


class AdminReadinessCatalog(BaseModel):
    """Everything, including inactive teams, retired checks and retired tag
    items, plus the code-defined allow-lists the admin forms pick from."""

    teams: list[AdminCatalogTeam]
    checks: list[AdminCatalogCheck]
    status_sets: dict[str, StatusSet]
    icon_keys: list[str]
    tag_lists: list[str] = []
    tag_items: list[AdminTagItem] = []


Category = Annotated[str, StringConstraints(strip_whitespace=True, max_length=64)]


class TagItemCreate(BaseModel):
    model_config = {"extra": "forbid"}

    tag_list: str
    code: TagCode
    label: Label
    category: Category = ""
    sort_order: SortOrder = 100

    @field_validator("tag_list")
    @classmethod
    def _known_tag_list(cls, value: str) -> str:
        if value not in TAG_LISTS:
            raise ValueError("Unknown tag list")
        return value


class TagItemUpdate(BaseModel):
    """Only label, category and order are editable — the code is fixed."""

    model_config = {"extra": "forbid"}

    label: Label | None = None
    category: Category | None = None
    sort_order: SortOrder | None = None

    @model_validator(mode="after")
    def _at_least_one(self) -> "TagItemUpdate":
        if all(v is None for v in (self.label, self.category, self.sort_order)):
            raise ValueError("Provide at least one field to change")
        return self


class TeamGrantsUpdate(BaseModel):
    """The FULL set of readiness teams the user may edit (replaces the old set)."""

    model_config = {"extra": "forbid"}

    teams: list[TeamCode] = Field(default_factory=list, max_length=50)


class TeamGrantsResponse(BaseModel):
    teams: list[str]
