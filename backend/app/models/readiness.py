"""Readiness catalog + entries (docs/readiness-framework-spec.md).

Readiness checks are rows in an admin-curated CATALOG (``readiness_checks``),
each owned by a TEAM (``readiness_teams``), rather than a hard-coded enum. The
values live in ``readiness_entries``, keyed by NAMES (campaign + field project
[+ well + activity type]), never by ``Activity.id``: a CSV re-import in replace
mode recreates every activity with a new id, and readiness must survive that.

Whether a check APPLIES to a target (phase 6, spec §3.8) is stored apart from
its status, in ``readiness_applicability``, under the same name key. Only checks
that don't lock with the plan get a row: the Project gates keep N/A instead.

What stays code-defined (a reviewed code change, not admin data):
- ``STATUS_SETS`` — the statuses a check may take and their shared severity, so
  rollups (dashboard %, worst-status dot) stay generic across teams. A set marked
  ``history_only`` is kept only so past revisions render.
- ``ICON_KEYS`` — the owned icon registry admins pick from. Admins can never
  upload SVG: the icons are embedded in the HTML/PDF export.
- ``SCOPES`` / ``EDITOR_SOURCES``.

``BUILTIN_TEAMS`` / ``BUILTIN_CHECKS`` are the Projects team and its checks as a
migrated database holds them — since phase 8 (migration 040,
docs/well-execution-readiness-spec.md) the eight WELL EXECUTION READINESS
checks: enabled at field-project AND well level, on the ``execution`` status
set. They seed the catalog for ``create_all`` on SQLite/tests (the
``after_create`` hooks below; PostgreSQL/SQL Server get there through migrations
034 and 040). ``LEGACY_BUILTIN_CHECKS`` are the original seven field-project
gates exactly as migration 034 seeded them: the fallback catalog for revisions
snapshotted before the catalog existed. Never edit them.
Codes are immutable and never reused, even after retirement.
"""
import uuid
from datetime import datetime
from typing import Any, Final, Protocol

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    event,
    func,
    true,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

# ── Code-defined allow-lists ────────────────────────────────────────────────

# Shared severity scale every status maps onto (spec §3.3).
# ``not_started`` (phase 8): counted, but neither done, on track nor behind.
SEVERITIES: Final = ("done", "in_progress", "not_started", "blocked", "not_counted")

# The status set of the checks that lock with the plan (phase 8) — and of no
# other check: "Not started" is not offered to Logistics or any other team.
EXECUTION_STATUS_SET: Final = "execution"

# status_set -> its statuses (in picker order) with their severity, plus the value
# an unset entry reads as. A default is ON TRACK (in_progress) — an unset check
# means nobody has reported a problem (spec §3.3, §3.7) — except ``execution``
# (phase 8), whose default is NOT STARTED: nobody has said the work is moving.
# A status name means the same severity in every set that has it, so a status
# alone fixes its severity.
# "history_only" (phase 6): kept so revisions that recorded it still render, but
# refused for new checks. Mirrored in frontend check-meta.ts (parity-tested).
STATUS_SETS: Final[dict[str, dict[str, Any]]] = {
    "standard": {
        "statuses": {
            "On Track": "in_progress",
            "Completed": "done",
            "Behind": "blocked",
            "N/A": "not_counted",
        },
        "default": "On Track",
    },
    # Well execution readiness (phase 8, docs/well-execution-readiness-spec.md
    # §A4): the Projects team's checks, and only they (``status_set_allowed``).
    # The standard statuses plus "Not started", which is also the default.
    EXECUTION_STATUS_SET: {
        "statuses": {
            "Not started": "not_started",
            "On Track": "in_progress",
            "Completed": "done",
            "Behind": "blocked",
            "N/A": "not_counted",
        },
        "default": "Not started",
    },
    # Nominated Equipment (decided 2026-10-13): is the equipment available?
    # "Pending" (2026-10-16) is the on-track default, so equipment nobody has
    # nominated yet doesn't count as behind. History only since phase 6: NEQ is
    # withdrawn (spec §3.5), and no new check may use this set.
    "availability": {
        "statuses": {
            "Pending": "in_progress",
            "Available": "done",
            "Not available": "blocked",
        },
        "default": "Pending",
        "history_only": True,
    },
}

# The status a Project gate is set to when it doesn't apply. Other teams' checks
# never pick it since phase 6: they untick the check instead (spec §3.3, §3.8).
NA_STATUS: Final = "N/A"

# Controlled multi-select lists a check may carry (its items are admin-managed
# rows in readiness_tag_items). "equipment" = the nominated equipment types.
# History only since phase 6: a check with a tag list is withdrawn (spec §4.4).
TAG_LISTS: Final = ("equipment",)


class CheckDefinition(Protocol):
    """What the rules below read from a check (a ``ReadinessCheck`` row, or a
    schema built from one)."""

    status_set: str
    tag_list: str
    locks_with_plan: bool


def is_history_only(status_set: str) -> bool:
    """True for a status set kept only so past revisions render (spec §3.3)."""
    return bool(STATUS_SETS.get(status_set, {}).get("history_only", False))


def is_withdrawn(check: CheckDefinition) -> bool:
    """A WITHDRAWN check (spec §4.4) — today ``NEQ``: its status set is history
    only, or it carries a tag list. A rule in code, not a column. It is retired
    (migration 038) and can't be restored, re-created or written."""
    return is_history_only(check.status_set) or check.tag_list != ""


def status_set_allowed(status_set: str, locks_with_plan: bool) -> bool:
    """Which status set a NEW check may use (phase 8): a check that locks with
    the plan — a Projects-team check — uses ``execution``; every other check
    uses any other set. So "Not started" stays with the well execution readiness
    checks."""
    return (status_set == EXECUTION_STATUS_SET) == locks_with_plan


def pickable_statuses(check: CheckDefinition) -> list[str]:
    """The statuses a person may pick for this check, in picker order (spec
    §3.3): its set's statuses, minus N/A when the check doesn't lock with the
    plan — those teams untick a check that doesn't apply instead (§3.8). Nothing
    is pickable on a history-only (or unknown) set."""
    spec = STATUS_SETS.get(check.status_set)
    if spec is None or spec.get("history_only", False):
        return []
    return [s for s in spec["statuses"] if check.locks_with_plan or s != NA_STATUS]


# Owned icon registry keys — mirrored by the frontend registry.
ICON_KEYS: Final = (
    "land-plot",
    "rotary-table",
    "map-pin",
    "drafting-compass",
    "gavel",
    "leaf",
    "banknote",
    # Phase 4 — Logistics
    "truck",
    "hand-coins",
    "file-signature",
    "forklift",
    "shield-check",
    "handshake",
    "receipt",
    "ship",
    # Phase 7 — more icons (spec §8.5, decision 40): all from lucide, appended
    # so existing keys keep their order. Grouped as the admin picker shows them.
    # Rigs and engineering
    "drill",
    "pickaxe",
    "wrench",
    "hammer",
    "gauge",
    "cable",
    "plug-zap",
    "factory",
    "warehouse",
    # Marine
    "anchor",
    "container",
    "ship-wheel",
    "sailboat",
    "life-buoy",
    "waves",
    # Aviation
    "helicopter",
    "plane",
    # Land transport
    "bus",
    "bus-front",
    "van",
    "car",
    "tractor",
    "caravan",
    # Lifting
    "construction",
    "hard-hat",
    # Permits and safety
    "radiation",
    "biohazard",
    "siren",
    "shield-user",
    "id-card",
    "key",
    "stamp",
    # Documents and finance
    "file-check",
    "file-text",
    "clipboard-check",
    "clipboard-list",
    "calendar-check",
    "badge-check",
    "landmark",
    "wallet",
    "coins",
    "scale",
    # People and community
    "users",
    # Environment
    "mountain",
    "tree-pine",
    "droplets",
    "flame",
    "fuel",
    "wind",
    "thermometer",
    "cloud-rain",
    # Comms
    "radio",
    "satellite-dish",
)

SCOPES: Final = ("project", "well")
EDITOR_SOURCES: Final = ("planner", "team_grant")

PROJECTS_TEAM: Final = "projects"

BUILTIN_TEAMS: Final[tuple[dict[str, Any], ...]] = (
    {
        "code": PROJECTS_TEAM,
        "name": "Projects",
        "editor_source": "planner",
        "icon_key": "land-plot",
        "sort_order": 0,
        "is_active": True,
    },
)


def _gate(code: str, label: str, icon_key: str, sort_order: int) -> dict[str, Any]:
    return {
        "code": code,
        "label": label,
        "team_code": PROJECTS_TEAM,
        "applies_project": True,
        "applies_well": False,
        "status_set": "standard",
        "icon_key": icon_key,
        "locks_with_plan": True,
        "tag_list": "",
        "sort_order": sort_order,
    }


# The original seven field-project gates, as migration 034 seeded them — the
# catalog of revisions that predate ``catalog_json``. History: never edit.
LEGACY_BUILTIN_CHECKS: Final[tuple[dict[str, Any], ...]] = (
    _gate("FDP", "Field Development Plan", "land-plot", 10),
    _gate("LLI", "Long Lead Items", "rotary-table", 20),
    _gate("LOC", "Location", "map-pin", 30),
    _gate("FE", "Wells Front End", "drafting-compass", 40),
    _gate("FID", "Final Inv. Decision", "gavel", 50),
    _gate("EIA", "Env. Assessment", "leaf", 60),
    _gate("BUD", "Budget", "banknote", 70),
)


def _execution_check(code: str, label: str, icon_key: str, sort_order: int) -> dict[str, Any]:
    return {
        **_gate(code, label, icon_key, sort_order),
        "applies_well": True,
        "status_set": EXECUTION_STATUS_SET,
    }


# The well execution readiness checks (phase 8) — what migration 040 leaves in a
# migrated database: the seven gates relabelled and reordered as the "Well
# Execution Readiness" sheet has them, enabled at well level too, on the
# ``execution`` set, plus Well Permits. FID and LLI keep a spelled-out label —
# the sheet heads them by their codes, which every view already shows beside it.
# tests/test_migration_040_sqlite.py pins this list to the migration's own
# literals.
BUILTIN_CHECKS: Final[tuple[dict[str, Any], ...]] = (
    _execution_check("FDP", "Approved FDP/IP", "land-plot", 10),
    _execution_check("FID", "Final Investment Decision", "gavel", 20),
    _execution_check("BUD", "Budget Supported by Partners", "banknote", 30),
    _execution_check("FE", "Well Proposal", "drafting-compass", 40),
    _execution_check("EIA", "EIA/Waiver", "leaf", 50),
    _execution_check("LLI", "Long Lead Items", "rotary-table", 60),
    _execution_check("LOC", "Location Readiness", "map-pin", 70),
    _execution_check("WP", "Well Permits", "stamp", 80),
)


# ── Catalog ─────────────────────────────────────────────────────────────────


class ReadinessTeam(Base):
    """A team that owns a set of readiness checks (Projects, Wells, Logistics…).
    ``editor_source`` says who may edit its checks: campaign planners, or holders
    of a global team grant (Phase 2)."""

    __tablename__ = "readiness_teams"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    editor_source: Mapped[str] = mapped_column(String(16), nullable=False)
    icon_key: Mapped[str] = mapped_column(String(32), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class ReadinessCheck(Base):
    """One readiness check definition. ``code`` is immutable and never reused;
    a check is retired (``retired_at``), never deleted — stored entries and past
    revision snapshots still reference it."""

    __tablename__ = "readiness_checks"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(16), unique=True, nullable=False)
    label: Mapped[str] = mapped_column(String(64), nullable=False)
    team_code: Mapped[str] = mapped_column(
        ForeignKey("readiness_teams.code"), nullable=False
    )
    applies_project: Mapped[bool] = mapped_column(Boolean, nullable=False)
    applies_well: Mapped[bool] = mapped_column(Boolean, nullable=False)
    status_set: Mapped[str] = mapped_column(String(16), nullable=False)
    icon_key: Mapped[str] = mapped_column(String(32), nullable=False)
    # Governed (True): part of the approved snapshot, frozen with the plan (423).
    # Operational (False): stays editable after submit/approval.
    locks_with_plan: Mapped[bool] = mapped_column(Boolean, nullable=False)
    # Controlled multi-select list this check carries ("" = none).
    tag_list: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    retired_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    # Phase 7 (spec §3.9, §4.5, migration 039). An admin-editable label grouping
    # checks within a team ("" = none) — e.g. Vessels, Barges. Grouped by exact
    # text. Always "" for a check that locks with the plan (the Project gates
    # keep their seven icons). Not named ``group``: a reserved word everywhere.
    category: Mapped[str] = mapped_column(
        String(64), nullable=False, default="", server_default=""
    )
    # False = "starts unticked": with no applicability row on the target (or on
    # its field project, for a well) the check doesn't apply — it is NOT
    # SELECTED and carries nothing (the 21 equipment checks). Fixed at creation:
    # changing it would flip every target with no tick of its own. Always True
    # for a check that locks with the plan, which has no tick list.
    applies_by_default: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=true()
    )


# ── Values ──────────────────────────────────────────────────────────────────


class ReadinessEntry(Base):
    """One check's value for one target in one campaign.

    - ``scope="project"``: a FIELD-DEVELOPMENT PROJECT (``Activity.well_project``,
      e.g. "Bonga Phase 3"), shared by every well under it. ``well_name`` and
      ``activity_type`` are the "" sentinel.
    - ``scope="well"`` (Phase 3): one well activity — project + well + activity type.

    "" (never NULL) is the not-applicable sentinel because NULLs are mutually
    distinct inside UNIQUE constraints on every backend we target.
    """

    __tablename__ = "readiness_entries"
    __table_args__ = (
        UniqueConstraint(
            "project_id",
            "check_code",
            "scope",
            "well_project",
            "well_name",
            "activity_type",
            name="uq_readiness_entry",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # The CAMPAIGN (code: Project) this entry belongs to.
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    check_code: Mapped[str] = mapped_column(
        ForeignKey("readiness_checks.code"), nullable=False
    )
    scope: Mapped[str] = mapped_column(String(8), nullable=False, default="project")
    # Matched exactly as stored on the activity.
    well_project: Mapped[str] = mapped_column(String(256), nullable=False)
    well_name: Mapped[str] = mapped_column(String(256), nullable=False, default="")
    activity_type: Mapped[str] = mapped_column(String(256), nullable=False, default="")
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    notes: Mapped[str | None] = mapped_column(String(512), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


class ReadinessApplicability(Base):
    """A team's choice that one check does or doesn't apply to one target in one
    campaign (phase 6, spec §3.8, §4.4). Stored apart from the status, so
    unticking keeps the status underneath and re-ticking brings it back.

    Only for checks that DON'T lock with the plan: the Project gates never get a
    row — a gate that doesn't apply is set to N/A instead (decision 31).

    - ``scope="project"``: a row exists only where the choice differs from the
      check's default (``ReadinessCheck.applies_by_default``, phase 7): ``False``
      for a check that starts ticked, ``True`` for one that starts unticked.
      Writing the default deletes it. Its wells follow it.
    - ``scope="well"``: the well's OWN choice (either value), written only where it
      differed from its field project at that moment, and kept until Follow
      project (or a write of the field project's current choice) removes it.
    - No row: the field project reads the check's default; a well follows its
      field project, or — with nothing to follow — reads the default.

    Keyed exactly like ``ReadinessEntry`` (names, "" sentinels), so it survives a
    CSV replace and follows renames as a pair with the status entry.
    """

    __tablename__ = "readiness_applicability"
    __table_args__ = (
        UniqueConstraint(
            "project_id",
            "check_code",
            "scope",
            "well_project",
            "well_name",
            "activity_type",
            name="uq_readiness_applicability",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # The CAMPAIGN (code: Project) this choice belongs to.
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    check_code: Mapped[str] = mapped_column(
        ForeignKey("readiness_checks.code"), nullable=False
    )
    scope: Mapped[str] = mapped_column(String(8), nullable=False, default="project")
    well_project: Mapped[str] = mapped_column(String(256), nullable=False)
    well_name: Mapped[str] = mapped_column(String(256), nullable=False, default="")
    activity_type: Mapped[str] = mapped_column(String(256), nullable=False, default="")
    # False = doesn't apply; True = applies (a well's own choice, or a field
    # project nominating a check that starts unticked).
    applies: Mapped[bool] = mapped_column(Boolean, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


# ── Tag lists (Nominated Equipment) ─────────────────────────────────────────
# Dormant since phase 6 (spec §3.5, §4.1): NEQ is withdrawn and no endpoint
# reads or writes these tables. The models stay because the tables do (history),
# and the SQL Server CI job's ``alembic check`` compares the two.


class ReadinessTagItem(Base):
    """One item of a controlled tag list — e.g. an equipment type ("PSV",
    "Platform Support Vessel", category "Vessels"). Admin-managed; ``code`` is
    immutable and never reused; items are retired, never deleted (entries that
    already carry one keep it)."""

    __tablename__ = "readiness_tag_items"
    __table_args__ = (UniqueConstraint("tag_list", "code", name="uq_readiness_tag_item"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    tag_list: Mapped[str] = mapped_column(String(32), nullable=False)
    code: Mapped[str] = mapped_column(String(16), nullable=False)
    label: Mapped[str] = mapped_column(String(64), nullable=False)
    # Display grouping only (Aviation, Vessels, Barges…).
    category: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    retired_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class ReadinessEntryTag(Base):
    """A tag on one readiness entry (e.g. PSV nominated for a well). A well's
    EFFECTIVE tags are its field project's ∪ its own (spec §3.5)."""

    __tablename__ = "readiness_entry_tags"
    __table_args__ = (UniqueConstraint("entry_id", "item_code", name="uq_readiness_entry_tag"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    entry_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("readiness_entries.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Validated in the app against the check's tag list (items are never deleted).
    item_code: Mapped[str] = mapped_column(String(16), nullable=False)


# ── Team grants ─────────────────────────────────────────────────────────────


class UserTeamGrant(Base):
    """A GLOBAL grant: the user may edit one team's readiness checks in every
    campaign (decided 2026-10-13 — one focal point per team; per-campaign adding
    causes entry fatigue and "nobody can edit" gaps on new or cloned campaigns).
    It confers nothing else: no schedule edits, no project gates, no signing.

    Admin-curated and audited (who granted is in the audit log). There is no
    ``granted_by`` FK: a second cascading FK to ``users`` would be a "multiple
    cascade paths" error on SQL Server.
    """

    __tablename__ = "user_team_grants"
    __table_args__ = (
        UniqueConstraint("user_id", "team_code", name="uq_user_team_grant"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    team_code: Mapped[str] = mapped_column(
        ForeignKey("readiness_teams.code"), nullable=False
    )
    granted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


# ── Seeding for create_all (SQLite dev + tests) ─────────────────────────────
# PostgreSQL / SQL Server are seeded by migration 034 instead; Alembic builds its
# own Table objects, so these hooks never fire there.


@event.listens_for(ReadinessTeam.__table__, "after_create")
def _seed_builtin_teams(target, connection, **_kw) -> None:  # type: ignore[no-untyped-def]
    connection.execute(target.insert(), [dict(t) for t in BUILTIN_TEAMS])


@event.listens_for(ReadinessCheck.__table__, "after_create")
def _seed_builtin_checks(target, connection, **_kw) -> None:  # type: ignore[no-untyped-def]
    connection.execute(target.insert(), [dict(c) for c in BUILTIN_CHECKS])
