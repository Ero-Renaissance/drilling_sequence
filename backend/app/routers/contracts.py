import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.rbac import assert_member
from app.database import get_db
from app.models.project import ProjectRole
from app.models.rig_contract import RigContract
from app.models.user import User
from app.schemas.rig_contract import RigContractResponse, RigContractUpsert

router = APIRouter(prefix="/api/projects/{project_id}/contracts", tags=["contracts"])

CurrentUser = Annotated[User, Depends(get_current_user)]
DB = Annotated[AsyncSession, Depends(get_db)]


@router.get("", response_model=list[RigContractResponse])
async def list_contracts(
    project_id: uuid.UUID, current_user: CurrentUser, db: DB
) -> list[RigContract]:
    await assert_member(project_id, current_user, db)
    result = await db.execute(
        select(RigContract)
        .where(RigContract.project_id == project_id)
        .order_by(RigContract.rig_name)
    )
    return list(result.scalars().all())


@router.put("/{rig_name}", response_model=RigContractResponse)
async def upsert_contract(
    project_id: uuid.UUID,
    rig_name: str,
    payload: RigContractUpsert,
    current_user: CurrentUser,
    db: DB,
) -> RigContract:
    await assert_member(project_id, current_user, db, allowed_roles={ProjectRole.planner})

    if not rig_name.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="rig_name cannot be empty",
        )

    result = await db.execute(
        select(RigContract).where(
            RigContract.project_id == project_id,
            RigContract.rig_name == rig_name,
        )
    )
    contract = result.scalar_one_or_none()

    if contract is None:
        contract = RigContract(
            project_id=project_id,
            rig_name=rig_name,
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

    await db.commit()
    await db.refresh(contract)
    return contract


@router.delete("/{rig_name}", status_code=204)
async def delete_contract(
    project_id: uuid.UUID,
    rig_name: str,
    current_user: CurrentUser,
    db: DB,
) -> None:
    await assert_member(project_id, current_user, db, allowed_roles={ProjectRole.planner})

    result = await db.execute(
        select(RigContract).where(
            RigContract.project_id == project_id,
            RigContract.rig_name == rig_name,
        )
    )
    contract = result.scalar_one_or_none()
    if contract is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contract not found")
    await db.delete(contract)
    await db.commit()
