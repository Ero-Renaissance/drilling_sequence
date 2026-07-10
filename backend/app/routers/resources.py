"""The resource registry API — physical rig/HWU units per campaign.

Rows are auto-created when activities are written (see services/registry.py);
this router lists them and lets the PLANNER edit attributes and perform the
audited rename-on-award. Identity semantics in docs/rig-registry-spec.md.
"""
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.locks import assert_project_not_locked
from app.core.rbac import assert_member
from app.database import get_db
from app.models.activity import Activity
from app.models.audit import AuditLog
from app.models.hwu_contract import HwuContract
from app.models.project import ProjectRole
from app.models.resource_registry import ResourceRecord, normalize_resource_name
from app.models.rig_contract import RigContract
from app.models.user import User
from app.schemas.resource import (
    ResourceConvert,
    ResourceRename,
    ResourceResponse,
    ResourceUpdate,
)
from app.services.audit import ENTITY_RESOURCE, governance_event

router = APIRouter(prefix="/api/projects/{project_id}/resources", tags=["resources"])

CurrentUser = Annotated[User, Depends(get_current_user)]
DB = Annotated[AsyncSession, Depends(get_db)]


def _lane(record: ResourceRecord) -> str:
    return f"{record.terrain} – {record.name}" if record.terrain else record.name


async def _get_record(
    project_id: uuid.UUID, resource_id: uuid.UUID, db: AsyncSession
) -> ResourceRecord:
    record = (
        await db.execute(
            select(ResourceRecord).where(
                ResourceRecord.id == resource_id,
                # BOLA guard: the row must belong to the project in the path.
                ResourceRecord.project_id == project_id,
            )
        )
    ).scalar_one_or_none()
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return record


@router.get("", response_model=list[ResourceResponse])
async def list_resources(
    project_id: uuid.UUID, current_user: CurrentUser, db: DB
) -> list[ResourceRecord]:
    # Reads are org-wide: any authenticated user may view campaign data.
    result = await db.execute(
        select(ResourceRecord)
        .where(ResourceRecord.project_id == project_id)
        .order_by(ResourceRecord.kind, ResourceRecord.terrain, ResourceRecord.name_key)
    )
    return list(result.scalars().all())


@router.patch("/{resource_id}", response_model=ResourceResponse)
async def update_resource(
    project_id: uuid.UUID,
    resource_id: uuid.UUID,
    payload: ResourceUpdate,
    current_user: CurrentUser,
    db: DB,
) -> ResourceRecord:
    """Edit unit attributes (capability class, placeholder flag) — never identity."""
    await assert_member(project_id, current_user, db, allowed_roles={ProjectRole.planner})
    record = await _get_record(project_id, resource_id, db)

    for field in ("capability_class", "is_placeholder"):
        if field in payload.model_fields_set:
            old = getattr(record, field)
            new = getattr(payload, field)
            if old == new:
                continue
            setattr(record, field, new)
            db.add(
                AuditLog(
                    project_id=project_id,
                    user_id=current_user.id,
                    entity_type=ENTITY_RESOURCE,
                    entity_id=record.id,
                    field=field,
                    old_value=str(old),
                    new_value=str(new),
                )
            )
    record.updated_by = current_user.id
    await db.commit()
    await db.refresh(record)
    return record


@router.post("/{resource_id}/rename", response_model=ResourceResponse)
async def rename_resource(
    project_id: uuid.UUID,
    resource_id: uuid.UUID,
    payload: ResourceRename,
    current_user: CurrentUser,
    db: DB,
) -> ResourceRecord:
    """Rename-on-award: mature a slot's name into the contracted unit's name.

    Atomically updates the registry row, every activity on the unit's lane, and
    its contract record; clears the placeholder flag; emits a governance audit
    event. Approved snapshots are NOT rewritten — the immutable record keeps the
    name that was approved, and the rename shows up in the next revision's diff.
    """
    await assert_member(project_id, current_user, db, allowed_roles={ProjectRole.planner})
    # Renames change snapshot-relevant plan data — frozen while a revision is pending.
    await assert_project_not_locked(project_id, db)
    record = await _get_record(project_id, resource_id, db)

    old_name, old_key = record.name, record.name_key
    new_name = payload.new_name
    new_key = normalize_resource_name(new_name)

    if new_key != old_key:
        clash = (
            await db.execute(
                select(ResourceRecord.id).where(
                    ResourceRecord.project_id == project_id,
                    ResourceRecord.kind == record.kind,
                    ResourceRecord.terrain == record.terrain,
                    ResourceRecord.name_key == new_key,
                    ResourceRecord.id != record.id,
                )
            )
        ).scalar_one_or_none()
        if clash is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"A {record.kind} named '{new_name}' already exists on this lane's terrain",
            )

    # The lane's activities. Rigs are terrain-scoped (COALESCE('') matches the
    # registry sentinel); HWUs are name-only — they are mobile across terrains.
    if record.kind == "rig":
        touched = await db.execute(
            update(Activity)
            .where(
                Activity.project_id == project_id,
                func.lower(func.trim(Activity.rig_name)) == old_key,
                func.coalesce(Activity.location, "") == record.terrain,
            )
            .values(rig_name=new_name, updated_by=current_user.id)
        )
        await db.execute(
            update(RigContract)
            .where(
                RigContract.project_id == project_id,
                func.lower(func.trim(RigContract.rig_name)) == old_key,
                RigContract.terrain == record.terrain,
            )
            .values(rig_name=new_name, updated_by=current_user.id)
        )
    else:
        touched = await db.execute(
            update(Activity)
            .where(
                Activity.project_id == project_id,
                func.lower(func.trim(Activity.hwu_name)) == old_key,
            )
            .values(hwu_name=new_name, updated_by=current_user.id)
        )
        await db.execute(
            update(HwuContract)
            .where(
                HwuContract.project_id == project_id,
                func.lower(func.trim(HwuContract.hwu_name)) == old_key,
            )
            .values(hwu_name=new_name, updated_by=current_user.id)
        )

    record.name = new_name
    record.name_key = new_key
    record.is_placeholder = False  # a unit with a real (awarded) name is procured
    record.updated_by = current_user.id

    db.add(
        governance_event(
            project_id=project_id,
            user_id=current_user.id,
            entity_type=ENTITY_RESOURCE,
            entity_id=record.id,
            action="resource_renamed",
            detail=(
                f"{record.kind} {_lane(record)}: renamed from '{old_name}' "
                f"({touched.rowcount} activities updated)"
            ),
            old_value=old_name,
        )
    )
    await db.commit()
    await db.refresh(record)
    return record


@router.delete("/{resource_id}", status_code=204)
async def remove_resource(
    project_id: uuid.UUID,
    resource_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
) -> None:
    """Remove a unit from the fleet roster (audited) — for spreadsheet
    artifacts that were never physical units (e.g. a method like "Rigless
    Clean/Well" written into the Rig column).

    Guarded so it can never orphan plan data: refused (409) while ANY activity
    — live or completed — still references the unit's lane, or while a contract
    is on file (remove that first, explicitly). With both guards passing the
    row is provably outside every plan artifact, so no plan-lock check is
    needed. Effectively reversible: a future activity or import that uses the
    name auto-registers the unit again (as a planned slot).
    """
    await assert_member(project_id, current_user, db, allowed_roles={ProjectRole.planner})
    record = await _get_record(project_id, resource_id, db)

    if record.kind == "rig":
        referenced = (
            await db.execute(
                select(func.count())
                .select_from(Activity)
                .where(
                    Activity.project_id == project_id,
                    func.lower(func.trim(Activity.rig_name)) == record.name_key,
                    func.coalesce(Activity.location, "") == record.terrain,
                )
            )
        ).scalar_one()
        contract = (
            await db.execute(
                select(RigContract.id).where(
                    RigContract.project_id == project_id,
                    func.lower(func.trim(RigContract.rig_name)) == record.name_key,
                    RigContract.terrain == record.terrain,
                )
            )
        ).scalar_one_or_none()
    else:
        referenced = (
            await db.execute(
                select(func.count())
                .select_from(Activity)
                .where(
                    Activity.project_id == project_id,
                    func.lower(func.trim(Activity.hwu_name)) == record.name_key,
                )
            )
        ).scalar_one()
        contract = (
            await db.execute(
                select(HwuContract.id).where(
                    HwuContract.project_id == project_id,
                    func.lower(func.trim(HwuContract.hwu_name)) == record.name_key,
                )
            )
        ).scalar_one_or_none()

    if referenced:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"'{record.name}' still has {referenced} "
                f"{'activity' if referenced == 1 else 'activities'} on its lane — "
                f"reassign or delete that work first."
            ),
        )
    if contract is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"'{record.name}' has a contract on file — remove the contract "
                f"first, then remove the unit."
            ),
        )

    db.add(
        governance_event(
            project_id=project_id,
            user_id=current_user.id,
            entity_type=ENTITY_RESOURCE,
            entity_id=record.id,
            action="resource_removed",
            detail=(
                f"{record.kind} {_lane(record)} removed from the fleet "
                f"(class {record.capability_class or '—'}, "
                f"{'planned slot' if record.is_placeholder else 'procured'})"
            ),
            old_value=_lane(record),
        )
    )
    await db.delete(record)
    await db.commit()


@router.post("/{resource_id}/convert", response_model=ResourceResponse)
async def convert_resource(
    project_id: uuid.UUID,
    resource_id: uuid.UUID,
    payload: ResourceConvert,
    current_user: CurrentUser,
    db: DB,
) -> ResourceRecord:
    """Reclassify a unit's kind — rig ↔ HWU (audited).

    Exists because planner sheets carry one "Rig" column, so HWUs arrive
    classified as rigs: terrain-locked, inflating the rig KPIs, and invisible
    to cross-terrain double-booking checks. Converting moves the unit's
    activities and contract atomically and re-keys identity — an HWU is mobile
    (terrain ""), so converting the second of two terrain twins MERGES it into
    the existing HWU (its overlaps then surface as real conflicts). The reverse
    (HWU → rig) requires the unit's activities to sit on a single terrain.
    """
    await assert_member(project_id, current_user, db, allowed_roles={ProjectRole.planner})
    # Conversion changes snapshot-relevant plan data — frozen while a revision
    # is pending, exactly like rename.
    await assert_project_not_locked(project_id, db)
    record = await _get_record(project_id, resource_id, db)

    if record.kind == payload.to:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"'{record.name}' is already a {payload.to}",
        )
    if payload.to == "hwu":
        return await _convert_rig_to_hwu(project_id, record, current_user, db)
    return await _convert_hwu_to_rig(project_id, record, current_user, db)


async def _convert_rig_to_hwu(
    project_id: uuid.UUID, record: ResourceRecord, user: User, db: AsyncSession
) -> ResourceRecord:
    old_lane = _lane(record)

    # A mobile twin may already exist (e.g. the other terrain's unit was
    # converted first) — this conversion then merges into it.
    existing = (
        await db.execute(
            select(ResourceRecord).where(
                ResourceRecord.project_id == project_id,
                ResourceRecord.kind == "hwu",
                ResourceRecord.terrain == "",
                ResourceRecord.name_key == record.name_key,
                ResourceRecord.id != record.id,
            )
        )
    ).scalar_one_or_none()
    target_name = existing.name if existing is not None else record.name

    # Contracts: the rig's (terrain-scoped) row moves to the HWU table. If an
    # HWU contract already exists with a DIFFERENT end date, the server must
    # not guess which one is real — the planner resolves it first.
    rig_contract = (
        await db.execute(
            select(RigContract).where(
                RigContract.project_id == project_id,
                func.lower(func.trim(RigContract.rig_name)) == record.name_key,
                RigContract.terrain == record.terrain,
            )
        )
    ).scalar_one_or_none()
    hwu_contract = (
        await db.execute(
            select(HwuContract).where(
                HwuContract.project_id == project_id,
                func.lower(func.trim(HwuContract.hwu_name)) == record.name_key,
            )
        )
    ).scalar_one_or_none()
    if (
        rig_contract is not None
        and hwu_contract is not None
        and rig_contract.contract_end != hwu_contract.contract_end
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"HWU '{target_name}' already has a contract ending "
                f"{hwu_contract.contract_end}, but this rig's ends "
                f"{rig_contract.contract_end} — remove one of the two first."
            ),
        )

    # Move the lane's activities (terrain-scoped, like rename).
    touched = await db.execute(
        update(Activity)
        .where(
            Activity.project_id == project_id,
            func.lower(func.trim(Activity.rig_name)) == record.name_key,
            func.coalesce(Activity.location, "") == record.terrain,
        )
        .values(rig_name=None, hwu_name=target_name, updated_by=user.id)
    )

    if rig_contract is not None:
        if hwu_contract is None:
            db.add(
                HwuContract(
                    project_id=project_id,
                    hwu_name=target_name,
                    contract_start=rig_contract.contract_start,
                    contract_end=rig_contract.contract_end,
                    notes=rig_contract.notes,
                    updated_by=user.id,
                )
            )
        await db.delete(rig_contract)

    if existing is not None:
        # Merge: procured status wins; keep the established class if set.
        existing.is_placeholder = existing.is_placeholder and record.is_placeholder
        existing.capability_class = existing.capability_class or record.capability_class
        existing.updated_by = user.id
        await db.delete(record)
        survivor = existing
    else:
        record.kind = "hwu"
        record.terrain = ""  # HWUs are mobile — never terrain-bound
        record.updated_by = user.id
        survivor = record

    await db.flush()
    db.add(
        governance_event(
            project_id=project_id,
            user_id=user.id,
            entity_type=ENTITY_RESOURCE,
            entity_id=survivor.id,
            action="resource_converted",
            detail=(
                f"rig {old_lane} → HWU {survivor.name} "
                f"({touched.rowcount} activities moved"
                + ("; merged with the existing HWU" if existing is not None else "")
                + ")"
            ),
            old_value=f"rig · {old_lane}",
        )
    )
    await db.commit()
    await db.refresh(survivor)
    return survivor


async def _convert_hwu_to_rig(
    project_id: uuid.UUID, record: ResourceRecord, user: User, db: AsyncSession
) -> ResourceRecord:
    # A rig is terrain-locked, so the unit's work must sit on ONE terrain.
    locations = (
        await db.execute(
            select(func.coalesce(Activity.location, "")).where(
                Activity.project_id == project_id,
                func.lower(func.trim(Activity.hwu_name)) == record.name_key,
            ).distinct()
        )
    ).scalars().all()
    terrains = {(loc or "").strip() for loc in locations}
    if len(terrains) > 1:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"'{record.name}' has activities on several terrains "
                f"({', '.join(sorted(t or '—' for t in terrains))}) — a rig is "
                f"terrain-locked, so reassign that work first."
            ),
        )
    target_terrain = next(iter(terrains)) if terrains else ""

    existing = (
        await db.execute(
            select(ResourceRecord).where(
                ResourceRecord.project_id == project_id,
                ResourceRecord.kind == "rig",
                ResourceRecord.terrain == target_terrain,
                ResourceRecord.name_key == record.name_key,
                ResourceRecord.id != record.id,
            )
        )
    ).scalar_one_or_none()
    target_name = existing.name if existing is not None else record.name

    hwu_contract = (
        await db.execute(
            select(HwuContract).where(
                HwuContract.project_id == project_id,
                func.lower(func.trim(HwuContract.hwu_name)) == record.name_key,
            )
        )
    ).scalar_one_or_none()
    rig_contract = (
        await db.execute(
            select(RigContract).where(
                RigContract.project_id == project_id,
                func.lower(func.trim(RigContract.rig_name)) == record.name_key,
                RigContract.terrain == target_terrain,
            )
        )
    ).scalar_one_or_none()
    if (
        hwu_contract is not None
        and rig_contract is not None
        and hwu_contract.contract_end != rig_contract.contract_end
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Rig '{target_name}' already has a contract ending "
                f"{rig_contract.contract_end}, but this HWU's ends "
                f"{hwu_contract.contract_end} — remove one of the two first."
            ),
        )

    touched = await db.execute(
        update(Activity)
        .where(
            Activity.project_id == project_id,
            func.lower(func.trim(Activity.hwu_name)) == record.name_key,
        )
        .values(hwu_name=None, rig_name=target_name, updated_by=user.id)
    )

    if hwu_contract is not None:
        if rig_contract is None:
            db.add(
                RigContract(
                    project_id=project_id,
                    rig_name=target_name,
                    terrain=target_terrain,
                    contract_start=hwu_contract.contract_start,
                    contract_end=hwu_contract.contract_end,
                    notes=hwu_contract.notes,
                    updated_by=user.id,
                )
            )
        await db.delete(hwu_contract)

    old_name = record.name
    if existing is not None:
        existing.is_placeholder = existing.is_placeholder and record.is_placeholder
        existing.capability_class = existing.capability_class or record.capability_class
        existing.updated_by = user.id
        await db.delete(record)
        survivor = existing
    else:
        record.kind = "rig"
        record.terrain = target_terrain
        record.updated_by = user.id
        survivor = record

    await db.flush()
    db.add(
        governance_event(
            project_id=project_id,
            user_id=user.id,
            entity_type=ENTITY_RESOURCE,
            entity_id=survivor.id,
            action="resource_converted",
            detail=(
                f"HWU {old_name} → rig {_lane(survivor)} "
                f"({touched.rowcount} activities moved"
                + ("; merged with the existing rig" if existing is not None else "")
                + ")"
            ),
            old_value=f"hwu · {old_name}",
        )
    )
    await db.commit()
    await db.refresh(survivor)
    return survivor
