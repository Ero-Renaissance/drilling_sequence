"""Shared ORM seeding of the phase 7 equipment checks (spec §4.5, "SQLite and
tests").

On PostgreSQL / SQL Server migration 039 seeds the 21 equipment checks; the
SQLite test schema is built with ``create_all``, which seeds only the Project
gates. Tests that need the equipment checks seed them here, from migration 039's
own literals (``seed_checks()``), so a test always sees exactly what a migrated
database holds: Logistics, both levels, the standard set, operational, starting
unticked, categorised.

Not a pytest module: nothing is collected from it.
"""
import importlib.util
from pathlib import Path
from types import ModuleType
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.readiness import ReadinessCheck, ReadinessTeam

_VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"


def _load(file_name: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(file_name.removesuffix(".py"), _VERSIONS / file_name)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def migration_036() -> ModuleType:
    return _load("036_logistics_readiness.py")


def migration_039() -> ModuleType:
    return _load("039_equipment_checks.py")


def equipment_definitions() -> list[dict[str, Any]]:
    """The 21 seeded definitions (no ids), in catalog order."""
    return migration_039().seed_checks()


# The 21 codes in catalog order (§3.4), and each one's category.
EQUIPMENT_CODES: list[str] = [d["code"] for d in equipment_definitions()]
EQUIPMENT_CATEGORIES: dict[str, str] = {d["code"]: d["category"] for d in equipment_definitions()}


async def seed_logistics_team(db: AsyncSession) -> ReadinessTeam:
    """The Logistics team as migration 036 seeds it — only if absent, so it
    composes with tests that create it through the admin API."""
    team = (
        await db.execute(select(ReadinessTeam).where(ReadinessTeam.code == "logistics"))
    ).scalar_one_or_none()
    if team is None:
        team = ReadinessTeam(**migration_036().LOGISTICS_TEAM)
        db.add(team)
        await db.flush()
    return team


async def seed_core_logistics_checks(db: AsyncSession) -> list[ReadinessCheck]:
    """The six core Logistics checks migration 036 seeds (``NEQ`` is withdrawn
    and left out), each only if its code is absent; commits."""
    await seed_logistics_team(db)
    added: list[ReadinessCheck] = []
    for code, label, status_set, icon_key, tag_list, order in migration_036().LOGISTICS_CHECKS:
        if tag_list or status_set != "standard":
            continue  # NEQ: withdrawn (spec §3.5)
        if await _exists(db, code):
            continue
        check = ReadinessCheck(
            code=code,
            label=label,
            team_code="logistics",
            applies_project=True,
            applies_well=True,
            status_set=status_set,
            icon_key=icon_key,
            locks_with_plan=False,
            tag_list="",
            sort_order=order,
        )
        db.add(check)
        added.append(check)
    await db.commit()
    return added


async def seed_equipment_checks(
    db: AsyncSession, codes: list[str] | None = None
) -> list[ReadinessCheck]:
    """The 21 equipment checks from migration 039's literals (or just ``codes``),
    each only if its code is absent; ensures the Logistics team; commits. Returns
    the checks it added, in catalog order."""
    await seed_logistics_team(db)
    wanted = set(codes) if codes is not None else None
    unknown = (wanted or set()) - set(EQUIPMENT_CODES)
    assert not unknown, f"not equipment codes: {sorted(unknown)}"
    added: list[ReadinessCheck] = []
    for definition in equipment_definitions():
        if wanted is not None and definition["code"] not in wanted:
            continue
        if await _exists(db, definition["code"]):
            continue
        check = ReadinessCheck(**definition)
        db.add(check)
        added.append(check)
    await db.commit()
    return added


async def _exists(db: AsyncSession, code: str) -> bool:
    found = await db.execute(select(ReadinessCheck.id).where(ReadinessCheck.code == code))
    return found.scalar_one_or_none() is not None
