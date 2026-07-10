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
from app.schemas.resource import ResourceRename, ResourceResponse, ResourceUpdate
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
