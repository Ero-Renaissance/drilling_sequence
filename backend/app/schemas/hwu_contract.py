import uuid
from datetime import date, datetime

from pydantic import BaseModel, field_validator


class HwuContractUpsert(BaseModel):
    """Create or replace the contract for an HWU.

    Same semantics as the rig contract: a contract IS its end date, so
    `contract_end` is required — removing a contract is the DELETE endpoint."""

    contract_start: date | None = None
    contract_end: date
    notes: str | None = None

    @field_validator("contract_end")
    @classmethod
    def _end_after_start(cls, v: date, info) -> date:
        start = info.data.get("contract_start") if info.data else None
        if start is not None and v < start:
            raise ValueError("contract_end must be on or after contract_start")
        return v


class HwuContractResponse(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    hwu_name: str
    contract_start: date | None
    contract_end: date | None
    notes: str | None
    updated_at: datetime

    model_config = {"from_attributes": True}
