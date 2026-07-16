from datetime import datetime
from typing import Literal

from pydantic import BaseModel

CheckCode = Literal["FDP", "LLI", "LOC", "FE", "FID", "EIA", "BUD"]
CheckStatus = Literal["On Track", "Completed", "Behind", "N/A"]


class CheckState(BaseModel):
    status: CheckStatus
    notes: str | None = None
    updated_at: datetime | None = None


class CheckUpsert(BaseModel):
    status: CheckStatus
    notes: str | None = None


class CheckUpsertResponse(BaseModel):
    well_project: str
    check_code: str
    status: str
    notes: str | None
    updated_at: datetime

    model_config = {"from_attributes": True}


class ProjectReadiness(BaseModel):
    """Readiness for one field-development project (the "Project" column) — the
    seven gates shared by every well/activity under it."""

    well_project: str
    checks: dict[str, CheckState]
    # Count of activities in the campaign that carry this project (context for the
    # grid: "Bonga Phase 3 · 4 activities").
    activity_count: int = 0
    # Frozen while a revision is awaiting approval (the readiness PUT 423s) — lets
    # the grid disable the controls up front, matching the campaign plan lock.
    locked: bool = False
