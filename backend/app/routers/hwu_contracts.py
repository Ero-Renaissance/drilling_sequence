import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.locks import assert_project_not_locked
from app.core.rbac import assert_member
from app.database import get_db
from app.models.hwu_contract import HwuContract
from app.models.project import ProjectRole
from app.models.user import User
from app.schemas.hwu_contract import HwuContractResponse, HwuContractUpsert
from app.services.audit import ENTITY_CONTRACT, contract_state, governance_event

router = APIRouter(prefix="/api/projects/{project_id}/hwu-contracts", tags=["hwu-contracts"])

CurrentUser = Annotated[User, Depends(get_current_user)]
DB = Annotated[AsyncSession, Depends(get_db)]


@router.get("", response_model=list[HwuContractResponse])
async def list_hwu_contracts(
    project_id: uuid.UUID, current_user: CurrentUser, db: DB
) -> list[HwuContract]:
    await assert_member(project_id, current_user, db)
    result = await db.execute(
        select(HwuContract)
        .where(HwuContract.project_id == project_id)
        .order_by(HwuContract.hwu_name)
    )
    return list(result.scalars().all())


@router.put("/{hwu_name}", response_model=HwuContractResponse)
async def upsert_hwu_contract(
    project_id: uuid.UUID,
    hwu_name: str,
    payload: HwuContractUpsert,
    current_user: CurrentUser,
    db: DB,
) -> HwuContract:
    await assert_member(project_id, current_user, db, allowed_roles={ProjectRole.planner})
    # CON readiness derives from the HWU contract — freeze it while a revision is
    # awaiting approval so the snapshot under review can't shift underneath it.
    await assert_project_not_locked(project_id, db)

    if not hwu_name.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="hwu_name cannot be empty",
        )

    result = await db.execute(
        select(HwuContract).where(
            HwuContract.project_id == project_id,
            HwuContract.hwu_name == hwu_name,
        )
    )
    contract = result.scalar_one_or_none()
    existed = contract is not None
    old_summary = (
        contract_state(contract.status, contract.contract_end) if existed else None
    )

    if not existed:
        contract = HwuContract(
            project_id=project_id,
            hwu_name=hwu_name,
            status=payload.status,
            contract_start=payload.contract_start,
            contract_end=payload.contract_end,
            notes=payload.notes,
            updated_by=current_user.id,
        )
        db.add(contract)
    else:
        contract.status = payload.status
        contract.contract_start = payload.contract_start
        contract.contract_end = payload.contract_end
        contract.notes = payload.notes
        contract.updated_by = current_user.id

    await db.flush()
    db.add(
        governance_event(
            project_id=project_id,
            user_id=current_user.id,
            entity_type=ENTITY_CONTRACT,
            entity_id=contract.id,
            action="contract_updated" if existed else "contract_created",
            detail=f"HWU {hwu_name}: {contract_state(contract.status, contract.contract_end)}",
            old_value=old_summary,
        )
    )
    await db.commit()
    await db.refresh(contract)
    return contract


@router.delete("/{hwu_name}", status_code=204)
async def delete_hwu_contract(
    project_id: uuid.UUID,
    hwu_name: str,
    current_user: CurrentUser,
    db: DB,
) -> None:
    await assert_member(project_id, current_user, db, allowed_roles={ProjectRole.planner})
    await assert_project_not_locked(project_id, db)

    result = await db.execute(
        select(HwuContract).where(
            HwuContract.project_id == project_id,
            HwuContract.hwu_name == hwu_name,
        )
    )
    contract = result.scalar_one_or_none()
    if contract is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contract not found")
    db.add(
        governance_event(
            project_id=project_id,
            user_id=current_user.id,
            entity_type=ENTITY_CONTRACT,
            entity_id=contract.id,
            action="contract_deleted",
            detail=f"HWU {hwu_name}: {contract_state(contract.status, contract.contract_end)}",
        )
    )
    await db.delete(contract)
    await db.commit()
