import uuid
from datetime import date, datetime

from pydantic import BaseModel, field_validator


class ActivityCreate(BaseModel):
    activity_type: str
    start_date: date
    end_date: date
    well_name: str | None = None
    rig_name: str | None = None
    project_group: str | None = None
    location: str | None = None
    readiness_check: str | None = None
    readiness_check_status: str | None = None
    risk: str | None = None
    comment: str | None = None
    plan_type: str | None = None
    rig_contract_expiry_date: date | None = None
    rig_contract_days_remaining: int | None = None

    @field_validator("end_date")
    @classmethod
    def end_after_start(cls, v: date, info: object) -> date:
        start = getattr(info, "data", {}).get("start_date")
        if start and v < start:
            raise ValueError("end_date must be on or after start_date")
        return v


class ActivityUpdate(BaseModel):
    activity_type: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    well_name: str | None = None
    rig_name: str | None = None
    project_group: str | None = None
    location: str | None = None
    readiness_check: str | None = None
    readiness_check_status: str | None = None
    risk: str | None = None
    comment: str | None = None
    plan_type: str | None = None
    rig_contract_expiry_date: date | None = None
    rig_contract_days_remaining: int | None = None
    # Optimistic lock: client sends back the updated_at it loaded; omit to skip check
    expected_updated_at: datetime | None = None


class ActivityResponse(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    activity_type: str
    start_date: date
    end_date: date
    well_name: str | None
    rig_name: str | None
    project_group: str | None
    location: str | None
    readiness_check: str | None
    readiness_check_status: str | None
    risk: str | None
    comment: str | None
    plan_type: str | None
    rig_contract_expiry_date: date | None
    rig_contract_days_remaining: int | None
    completed_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    updated_by_name: str | None = None
    locked_by_revision_id: uuid.UUID | None = None

    model_config = {"from_attributes": True}


class ImportResponse(BaseModel):
    imported: int
    replaced: bool
