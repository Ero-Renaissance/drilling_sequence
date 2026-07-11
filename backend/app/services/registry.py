"""Resource-registry services: auto-registration and identity lookups.

The registry (app/models/resource_registry.py) is the authority for what a
physical rig/HWU IS. Planners never manage it explicitly during normal work:
`ensure_registered` is called wherever activities are written, so typing a rig
name + location — exactly the Excel habit — registers the unit as a side
effect. New units start as placeholders (unprocured slots) until the planner
marks them real or renames them on award.
"""
import uuid

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.hwu_contract import HwuContract
from app.models.resource_registry import ResourceRecord, normalize_resource_name
from app.models.rig_contract import RigContract


def rig_terrain_key(location: str | None) -> str:
    """A rig's terrain component: its activity location, or "" when unset."""
    return (location or "").strip()


async def ensure_registered(
    db: AsyncSession,
    project_id: uuid.UUID,
    *,
    kind: str,
    name: str,
    location: str | None,
    user_id: uuid.UUID | None = None,
) -> ResourceRecord:
    """Get-or-create the registry row for a physical unit.

    Rigs key on (terrain, name); HWUs on (name) — they are mobile (spec Q1), so
    their terrain is always the "" sentinel. Name matching is trimmed and
    case-insensitive; the first casing seen becomes the display name.
    Concurrent creation is settled by the unique constraint (savepoint + retry).
    """
    terrain = rig_terrain_key(location) if kind == "rig" else ""
    name_key = normalize_resource_name(name)

    async def _find() -> ResourceRecord | None:
        return (
            await db.execute(
                select(ResourceRecord).where(
                    ResourceRecord.project_id == project_id,
                    ResourceRecord.kind == kind,
                    ResourceRecord.terrain == terrain,
                    ResourceRecord.name_key == name_key,
                )
            )
        ).scalar_one_or_none()

    existing = await _find()
    if existing is not None:
        return existing

    record = ResourceRecord(
        project_id=project_id,
        kind=kind,
        terrain=terrain,
        name=name.strip(),
        name_key=name_key,
        is_placeholder=True,  # new units are unprocured slots until told otherwise
        updated_by=user_id,
    )
    try:
        async with db.begin_nested():
            db.add(record)
    except IntegrityError:
        # Lost a race to a concurrent writer — the row exists now.
        found = await _find()
        if found is not None:
            return found
        raise
    return record


async def ensure_activity_resources_registered(
    db: AsyncSession,
    project_id: uuid.UUID,
    resources: "set[tuple[str, str, str | None]]",
    user_id: uuid.UUID | None = None,
) -> None:
    """Register a batch of (kind, name, location) triples (deduped by caller)."""
    for kind, name, location in sorted(
        resources, key=lambda r: (r[0], r[1], r[2] or "")
    ):
        await ensure_registered(
            db, project_id, kind=kind, name=name, location=location, user_id=user_id
        )


async def lane_contract_rows(
    db: AsyncSession,
    project_id: uuid.UUID,
    *,
    kind: str,
    name: str,
    terrain: str = "",
) -> list[RigContract | HwuContract]:
    """All contract rows for a physical unit's lane, matched like the registry —
    trimmed, case-insensitively — so "10K RIG 1" from a sheet and "10K Rig 1"
    from the grid resolve to the same unit. Rigs filter on terrain (identity is
    (terrain, name)); HWUs are mobile and match on name alone.

    More than one row means case-variant duplicates predating the normalized
    contract endpoints (the upsert once matched names byte-for-byte).
    """
    name_key = normalize_resource_name(name)
    if kind == "rig":
        stmt = select(RigContract).where(
            RigContract.project_id == project_id,
            func.lower(func.trim(RigContract.rig_name)) == name_key,
            RigContract.terrain == terrain,
        )
    else:
        stmt = select(HwuContract).where(
            HwuContract.project_id == project_id,
            func.lower(func.trim(HwuContract.hwu_name)) == name_key,
        )
    return list((await db.execute(stmt)).scalars().all())


async def sole_lane_contract(
    db: AsyncSession,
    project_id: uuid.UUID,
    *,
    kind: str,
    name: str,
    terrain: str = "",
) -> RigContract | HwuContract | None:
    """The lane's single contract row, or None. Case-variant duplicates are an
    ambiguous state no write should guess through — mutating them in bulk would
    collapse both rows onto one name and trip the unique constraint mid-flight —
    so they are refused with an actionable 409: deleting the contract clears
    every variant, after which the planner can re-create it and retry."""
    rows = await lane_contract_rows(db, project_id, kind=kind, name=name, terrain=terrain)
    if len(rows) > 1:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"'{name.strip()}' has {len(rows)} contract rows differing only in "
                f"name casing — remove the contract (which clears every variant), "
                f"re-create it, then retry."
            ),
        )
    return rows[0] if rows else None


async def rig_terrains_in_project(
    db: AsyncSession, project_id: uuid.UUID, rig_name: str
) -> list[str]:
    """The distinct terrains a rig NAME occupies in this campaign's registry —
    used to resolve which physical unit a name-only reference (e.g. a legacy
    contract upsert) means. One entry = unambiguous; more = caller must ask."""
    rows = (
        await db.execute(
            select(ResourceRecord.terrain).where(
                ResourceRecord.project_id == project_id,
                ResourceRecord.kind == "rig",
                ResourceRecord.name_key == normalize_resource_name(rig_name),
            )
        )
    ).scalars().all()
    return sorted(set(rows))
