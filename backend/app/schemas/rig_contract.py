import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, field_validator

ContractStatus = Literal["N/A", "Not Started", "In Progress", "Completed"]


class RigContractUpsert(BaseModel):
    """Create or replace the contract for a rig."""

    status: ContractStatus = "Not Started"
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
    status: ContractStatus
    contract_start: date | None
    contract_end: date | None
    notes: str | None
    updated_at: datetime

    model_config = {"from_attributes": True}
