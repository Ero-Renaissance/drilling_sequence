from pydantic import BaseModel


class FieldChange(BaseModel):
    field: str
    old: str | None
    new: str | None


class ActivityDiff(BaseModel):
    # "added" | "removed" | "modified"
    change: str
    activity_id: str
    activity_type: str
    well_name: str | None = None
    rig_name: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    # Populated for "modified" rows; empty for added/removed.
    fields: list[FieldChange] = []


class DiffSide(BaseModel):
    # "revision" | "live"
    kind: str
    revision_id: str | None = None
    rev_number: int | None = None
    label: str | None = None


class DiffSummary(BaseModel):
    added: int
    removed: int
    modified: int
    unchanged: int
    base_start: str | None = None
    base_end: str | None = None
    target_start: str | None = None
    target_end: str | None = None
    start_shift_days: int | None = None
    end_shift_days: int | None = None
    base_duration_days: int | None = None
    target_duration_days: int | None = None
    duration_shift_days: int | None = None


class RevisionDiffResponse(BaseModel):
    base: DiffSide
    target: DiffSide
    summary: DiffSummary
    activities: list[ActivityDiff]
