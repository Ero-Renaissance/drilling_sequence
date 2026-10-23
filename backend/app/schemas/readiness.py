from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    Field,
    StrictBool,
    StringConstraints,
    computed_field,
    field_validator,
    model_validator,
)

from app.models.readiness import ICON_KEYS, STATUS_SETS, is_history_only, is_withdrawn

# Check codes and statuses are no longer fixed enums here: codes come from the
# admin-curated catalog and statuses from each check's code-defined status set
# (app/models/readiness.py). The router validates both against those allow-lists;
# the schema bounds the raw strings.
Status = Annotated[str, StringConstraints(min_length=1, max_length=32)]
Severity = Literal["done", "in_progress", "blocked", "not_counted"]


class CheckState(BaseModel):
    """One cell's status. The Project gates' shape (``GET /readiness``): a gate
    that doesn't apply simply reads N/A (decision 31). ``tags`` left with
    Nominated Equipment (phase 6, spec §3.5)."""

    status: str
    notes: str | None = None
    updated_at: datetime | None = None


# Where a cell's status — or its tick — comes from.
CellSource = Literal["well", "project", "default"]


class TeamCheckState(CheckState):
    """A cell of a team's rows (phase 6, spec §5.1 "Cells"). ``status`` is the
    status underneath — what re-ticking brings back; ``applies`` is whether the
    check applies to the target at all (§3.8), and ``applies_source`` where that
    comes from: the well's own choice, its field project's, or the default
    (applies). A check that locks with the plan (a Project gate) always reads
    ``applies=True`` from ``"default"`` — it uses N/A instead."""

    applies: bool = True
    applies_source: CellSource = "default"


Name = Annotated[str, StringConstraints(min_length=1, max_length=256)]


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
    # extra="forbid": an unknown field — ``tags`` included, since Nominated
    # Equipment is withdrawn (spec §5.1) — is a 422, never silently ignored.
    model_config = {"extra": "forbid"}

    # Validated against the check's pickable statuses in the router (422
    # otherwise): its status set, minus N/A for a check that doesn't lock with
    # the plan (spec §3.3).
    status: Status
    # Bounded to the String(512) column so an over-long note is a 422, not a DB error.
    notes: Annotated[str, StringConstraints(max_length=512)] | None = None


class CheckUpsertResponse(BaseModel):
    scope: str = "project"
    well_project: str
    well_name: str = ""
    activity_type: str = ""
    check_code: str
    status: str
    notes: str | None
    updated_at: datetime

    model_config = {"from_attributes": True}


# Bounded like the String(16) code column; the router validates each code
# against the catalog (an active check of the team — an allow-list).
ApplicabilityCode = Annotated[str, StringConstraints(min_length=1, max_length=16)]


class ApplicabilityUpdate(WellTarget):
    """Which of a team's checks apply to one target (phase 6, spec §3.8, §5.1)
    — the body of ``PUT /readiness/teams/{team}/applicability``. Names travel in
    the body, as for the status PUT (DS-001).

    ``applies`` lists 1–50 codes; only those change, so a client with a stale
    catalog can't untick a check it doesn't know about:
    - field project: ``true`` applies (deletes its row), ``false`` doesn't;
      ``null`` is refused — a field project has nothing to follow;
    - well: ``true`` / ``false`` are the well's own choice (stored only while it
      differs from its field project's); ``null`` is Follow project.
    StrictBool: "false" or 0 is a 422, never coerced into a choice.
    """

    model_config = {"extra": "forbid"}

    applies: dict[ApplicabilityCode, StrictBool | None] = Field(min_length=1, max_length=50)

    @model_validator(mode="after")
    def _follow_needs_a_well(self) -> "ApplicabilityUpdate":
        if self.scope == "project" and any(v is None for v in self.applies.values()):
            raise ValueError("A field project has no field project to follow; use true or false")
        return self


class RowFigures(BaseModel):
    """One row's readiness by the rollup of spec §3.7 (each row is one target).
    The grid adds the counts of the rows it shows and divides — it never decides
    which cells count; the server does."""

    counted: int  # cells that count (not N/A, and the check applies)
    done: int
    in_progress: int  # on track
    behind: int  # blocked (Behind, Not available)
    na: int = 0  # not counted (N/A, or a team check that doesn't apply)
    ready: bool  # ≥1 counted cell and every counted cell done


class ProjectReadiness(BaseModel):
    """Readiness for one field-development project (the "Project" column) — the
    seven gates shared by every well/activity under it."""

    well_project: str
    checks: dict[str, CheckState]
    # Count of activities in the campaign that carry this project (context for the
    # grid: "Bonga Phase 3 · 4 activities").
    activity_count: int = 0
    # Frozen while the plan is locked by a revision, pending or approved (the
    # gates' status PUT 423s) — lets the grid disable the controls up front,
    # matching the campaign plan lock.
    locked: bool = False
    # Earliest start date of a not-done, readiness-required activity under this
    # field project. Lets the readiness page apply the same focus window the
    # Overview KPI uses — a project is "in the next N months" iff
    # ``focus_start <= today + N``. None when the project has no pending
    # readiness-required work (all done or opt-out): it never falls in a window.
    focus_start: date | None = None
    # Days from the SERVER's today to focus_start, so the browser windows rows on
    # the server's calendar — exactly as the Overview tile does (spec §3.7).
    focus_in_days: int | None = None
    # The row's rollup (spec §3.7) over its gates at their effective values.
    figures: RowFigures | None = None


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
    # "" = none; else the controlled tag list the check carried ("equipment").
    # History only since phase 6 (spec §3.5): kept so frozen catalogs read as
    # recorded; no new check may carry one.
    tag_list: str = ""

    model_config = {"from_attributes": True}


class StatusOption(BaseModel):
    status: str
    severity: Severity


class StatusSet(BaseModel):
    statuses: list[StatusOption]
    default: str
    # Kept only so past revisions render (``availability``, spec §3.3): refused
    # for a new check, so the admin form doesn't offer it.
    history_only: bool = False


def status_sets_payload() -> dict[str, StatusSet]:
    """The code-defined status sets as both catalogs serve them."""
    return {
        name: StatusSet(
            statuses=[StatusOption(status=s, severity=sev) for s, sev in spec["statuses"].items()],
            default=spec["default"],
            history_only=is_history_only(name),
        )
        for name, spec in STATUS_SETS.items()
    }


class ReadinessCatalog(BaseModel):
    teams: list[CatalogTeam]
    checks: list[CatalogCheck]
    status_sets: dict[str, StatusSet]


# ── Team lens (GET /readiness/teams/{team_code}) ────────────────────────────


class EffectiveCheckState(TeamCheckState):
    """A check's value as a well sees it. ``source`` is where the STATUS comes
    from: its own entry ("well"), else the field project's ("project" —
    inherited, for checks enabled at project level, and only while the check
    applies to the field project), else the status set's default ("default").
    Whether it applies inherits separately (``applies_source``, spec §3.8)."""

    source: CellSource


class TeamProjectRow(BaseModel):
    well_project: str
    activity_count: int
    checks: dict[str, TeamCheckState]  # the team's project-level checks only
    # Earliest start of a not-done, readiness-required activity under this field
    # project (None: nothing left to be ready for) — the window filter's signal.
    focus_start: date | None = None
    focus_in_days: int | None = None  # days from the server's today to focus_start
    figures: RowFigures | None = None  # over the team's project-level checks


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
    focus_in_days: int | None = None  # days from the server's today to focus_start
    # Every team check the well carries, at its effective value — a project-only
    # check is absent on a well with no field project (spec §3.7, §7.12).
    checks: dict[str, EffectiveCheckState]
    figures: RowFigures | None = None  # over those cells; one that doesn't apply isn't counted


class TeamReadiness(BaseModel):
    team: CatalogTeam
    checks: list[CatalogCheck]
    project_rows: list[TeamProjectRow]
    well_rows: list[TeamWellRow]
    # The plan lock — only checks that lock with the plan are frozen by it.
    locked: bool


class ApplicabilityResult(BaseModel):
    """What an applicability write changed, built exactly as the team read builds
    its rows: for a field project, its row plus every well row under it (they
    follow it); for a well, its row. The picker redraws from it."""

    project_rows: list[TeamProjectRow]
    well_rows: list[TeamWellRow]


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
    # Tag lists are history only since phase 6 (Nominated Equipment withdrawn,
    # spec §3.5, §4.4): only "" (none) is accepted. Kept as a field so an old
    # client sending "" still works and one sending a list gets a clear 422.
    tag_list: str = ""

    _icon = field_validator("icon_key")(_check_icon_key)

    @field_validator("tag_list")
    @classmethod
    def _no_tag_list(cls, value: str) -> str:
        if value:
            raise ValueError("Tag lists are history only; a new check can't carry one")
        return value

    @field_validator("status_set")
    @classmethod
    def _known_status_set(cls, value: str) -> str:
        if value not in STATUS_SETS:
            raise ValueError("Unknown status set")
        # A history-only set (availability) would create a withdrawn check.
        if is_history_only(value):
            raise ValueError("That status set is history only; a new check can't use it")
        return value

    @model_validator(mode="after")
    def _scope_rules(self) -> "CheckCreate":
        if not (self.applies_project or self.applies_well):
            raise ValueError("A check must apply at project level, well level, or both")
        # Governed checks are frozen into the snapshot's field-project readiness
        # block — they exist only at field-project level (spec §3.2).
        if self.locks_with_plan and (self.applies_well or not self.applies_project):
            raise ValueError("A check that locks with the plan is set at project level only")
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

    @computed_field  # type: ignore[prop-decorator]
    @property
    def withdrawn(self) -> bool:
        """Retired for good (spec §4.4) — a history-only status set or a tag list;
        today ``NEQ``. Restore is refused (409), so the Admin page hides it. The
        rule in code (``is_withdrawn``), never a column."""
        return is_withdrawn(self)


class AdminReadinessCatalog(BaseModel):
    """Everything, including inactive teams and retired checks, plus the
    code-defined allow-lists the admin forms pick from (a ``history_only``
    status set is listed, never offered for a new check). Tag lists and their
    items left with Nominated Equipment (phase 6)."""

    teams: list[AdminCatalogTeam]
    checks: list[AdminCatalogCheck]
    status_sets: dict[str, StatusSet]
    icon_keys: list[str]


class TeamGrantsUpdate(BaseModel):
    """The FULL set of readiness teams the user may edit (replaces the old set)."""

    model_config = {"extra": "forbid"}

    teams: list[TeamCode] = Field(default_factory=list, max_length=50)


class TeamGrantsResponse(BaseModel):
    teams: list[str]
