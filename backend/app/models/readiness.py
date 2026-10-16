"""Readiness catalog + entries (docs/readiness-framework-spec.md).

Readiness checks are rows in an admin-curated CATALOG (``readiness_checks``),
each owned by a TEAM (``readiness_teams``), rather than a hard-coded enum. The
values live in ``readiness_entries``, keyed by NAMES (campaign + field project
[+ well + activity type]), never by ``Activity.id``: a CSV re-import in replace
mode recreates every activity with a new id, and readiness must survive that.

What stays code-defined (a reviewed code change, not admin data):
- ``STATUS_SETS`` — the statuses a check may take and their shared severity, so
  rollups (dashboard %, worst-status dot) stay generic across teams.
- ``ICON_KEYS`` — the owned icon registry admins pick from. Admins can never
  upload SVG: the icons are embedded in the HTML/PDF export.
- ``SCOPES`` / ``EDITOR_SOURCES``.

``BUILTIN_TEAMS`` / ``BUILTIN_CHECKS`` are the original seven field-project
gates. They seed the catalog (migration 034 for PostgreSQL/SQL Server, the
``after_create`` hooks below for ``create_all`` on SQLite/tests), and they are
the fallback catalog for revisions snapshotted before the catalog existed.
Codes are immutable and never reused, even after retirement.
"""
import uuid
from datetime import datetime
from typing import Any, Final

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    event,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

# ── Code-defined allow-lists ────────────────────────────────────────────────

# Shared severity scale every status maps onto (spec §3.3).
SEVERITIES: Final = ("done", "in_progress", "blocked", "not_counted")

# status_set -> its statuses (in picker order) with their severity, plus the value
# an unset entry reads as. Every default is ON TRACK (in_progress): an unset check
# means nobody has reported a problem — how planners work (spec §3.3, §3.7).
# Status names are unique across sets, so a status alone fixes its severity.
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
    # Nominated Equipment (decided 2026-10-13): is the equipment available?
    # "Pending" (2026-10-16) is the on-track default, so equipment nobody has
    # nominated yet doesn't count as behind.
    "availability": {
        "statuses": {
            "Pending": "in_progress",
            "Available": "done",
            "Not available": "blocked",
        },
        "default": "Pending",
    },
}

# Controlled multi-select lists a check may carry (its items are admin-managed
# rows in readiness_tag_items). "equipment" = the nominated equipment types.
TAG_LISTS: Final = ("equipment",)

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


BUILTIN_CHECKS: Final[tuple[dict[str, Any], ...]] = (
    _gate("FDP", "Field Development Plan", "land-plot", 10),
    _gate("LLI", "Long Lead Items", "rotary-table", 20),
    _gate("LOC", "Location", "map-pin", 30),
    _gate("FE", "Wells Front End", "drafting-compass", 40),
    _gate("FID", "Final Inv. Decision", "gavel", 50),
    _gate("EIA", "Env. Assessment", "leaf", 60),
    _gate("BUD", "Budget", "banknote", 70),
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


# ── Tag lists (Nominated Equipment) ─────────────────────────────────────────


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
