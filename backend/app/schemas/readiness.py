import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel

CheckCode = Literal["FDP", "LLI", "LOC", "FE", "FID", "EIA", "BUD", "CON"]
CheckStatus = Literal["On Track", "Completed", "Behind", "N/A"]


class CheckState(BaseModel):
    status: CheckStatus
    notes: str | None = None
    updated_at: datetime | None = None


class CheckUpsert(BaseModel):
    status: CheckStatus
    notes: str | None = None


class CheckUpsertResponse(BaseModel):
    check_code: str
    status: str
    notes: str | None
    updated_at: datetime

    model_config = {"from_attributes": True}


class ActivityReadiness(BaseModel):
    activity_id: uuid.UUID
    activity_type: str
    well_name: str | None
    rig_name: str | None
    hwu_name: str | None
    start_date: date
    end_date: date
    checks: dict[str, CheckState]
    # Frozen while a revision is awaiting approval (the readiness PUT 423s) — lets
    # the grid disable the dots up front, matching the per-activity lock.
    locked: bool = False
