import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, field_validator

ContractStatus = Literal["Draft", "Completed"]

# Terrain allow-list — rig identity is (terrain, name); see resource_registry.
ContractTerrain = Literal["LAND", "SWAMP", "OFFSHORE"]


class RigContractUpsert(BaseModel):
    """Create or replace the contract for a rig.

    `terrain` names WHICH physical rig when a name exists in more than one
    terrain (e.g. a LAND and a SWAMP "10K Rig 1"). Omitted, the server resolves
    it from the registry when unambiguous and 409s when it isn't — so existing
    clients keep working for every single-terrain rig."""

    status: ContractStatus = "Draft"
    terrain: ContractTerrain | None = None
    contract_start: date | None = None
    contract_end: date | None = None
    notes: str | None = None

    @field_validator("contract_end")
    @classmethod
    def _end_after_start(cls, v: date | None, info) -> date | None:
        start = info.data.get("contract_start") if info.data else None
        if v is not None and start is not None and v < start:
            raise ValueError("contract_end must be on or after contract_start")
        return v


class RigContractResponse(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    rig_name: str
    terrain: str  # "" = unassigned/legacy
    status: ContractStatus
    contract_start: date | None
    contract_end: date | None
    notes: str | None
    updated_at: datetime

    model_config = {"from_attributes": True}
