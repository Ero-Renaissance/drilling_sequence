"""Reading the readiness catalog (docs/readiness-framework-spec.md §3–4).

Everything that used to iterate the hard-coded ``CHECK_CODES`` asks this module
which checks apply instead, so a check added or retired by an admin flows to the
grid, snapshot and dashboard without a code change.
"""
import json
import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.readiness import (
    BUILTIN_CHECKS,
    PROJECTS_TEAM,
    STATUS_SETS,
    ReadinessCheck,
    ReadinessTeam,
)

logger = logging.getLogger(__name__)

# The fields of a check definition frozen into a revision's catalog_json.
_DEFINITION_FIELDS = (
    "code",
    "label",
    "team_code",
    "applies_project",
    "applies_well",
    "status_set",
    "icon_key",
    "locks_with_plan",
    "sort_order",
)


async def active_checks(
    db: AsyncSession,
    *,
    team_code: str | None = None,
    project_scope: bool | None = None,
    governed: bool | None = None,
) -> list[ReadinessCheck]:
    """Non-retired checks in display order, optionally narrowed."""
    stmt = select(ReadinessCheck).where(ReadinessCheck.retired_at.is_(None))
    if team_code is not None:
        stmt = stmt.where(ReadinessCheck.team_code == team_code)
    if project_scope is not None:
        stmt = stmt.where(ReadinessCheck.applies_project == project_scope)
    if governed is not None:
        stmt = stmt.where(ReadinessCheck.locks_with_plan == governed)
    stmt = stmt.order_by(ReadinessCheck.sort_order, ReadinessCheck.code)
    return list((await db.execute(stmt)).scalars().all())


async def project_gate_checks(db: AsyncSession) -> list[ReadinessCheck]:
    """The field-project gates the "Project gates" lens shows (today's 7)."""
    return await active_checks(db, team_code=PROJECTS_TEAM, project_scope=True)


async def governed_project_checks(db: AsyncSession) -> list[ReadinessCheck]:
    """Checks frozen into the snapshot's ``readiness`` block and the plan lock."""
    return await active_checks(db, project_scope=True, governed=True)


async def active_teams(db: AsyncSession) -> list[ReadinessTeam]:
    stmt = (
        select(ReadinessTeam)
        # Bare boolean column: "= 1" on SQL Server (.is_(True) → "IS 1", invalid).
        .where(ReadinessTeam.is_active)
        .order_by(ReadinessTeam.sort_order, ReadinessTeam.code)
    )
    return list((await db.execute(stmt)).scalars().all())


def default_status(status_set: str) -> str:
    """What an unset entry of this status set reads as."""
    return STATUS_SETS[status_set]["default"]


def is_valid_status(status_set: str, status: str) -> bool:
    spec = STATUS_SETS.get(status_set)
    return spec is not None and status in spec["statuses"]


def definition(check: ReadinessCheck) -> dict[str, Any]:
    """A check's definition as frozen into a revision's catalog_json."""
    return {field: getattr(check, field) for field in _DEFINITION_FIELDS}


def builtin_definitions() -> list[dict[str, Any]]:
    """The original seven gates — the catalog of pre-catalog revisions."""
    return [{f: c[f] for f in _DEFINITION_FIELDS} for c in BUILTIN_CHECKS]


def definitions_from_json(raw: str | None) -> list[dict[str, Any]]:
    """A revision's frozen catalog, or the built-in gates when it predates the
    catalog (NULL) or the stored value is unreadable."""
    if raw is None:
        return builtin_definitions()
    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError):
        logger.warning("revision catalog_json unreadable; using built-in gates")
        return builtin_definitions()
    if not isinstance(parsed, list):
        logger.warning("revision catalog_json is not a list; using built-in gates")
        return builtin_definitions()
    return [d for d in parsed if isinstance(d, dict) and isinstance(d.get("code"), str)]
