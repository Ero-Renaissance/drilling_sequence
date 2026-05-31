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
    # For "removed" rows only: "completed" (finished, dropped on clone) or
    # "dropped" (deleted while still open). None for added/modified.
    removal_reason: str | None = None
    # True when the activity is marked done on the surviving (target) side.
    completed: bool = False


class DiffSide(BaseModel):
    # "revision" | "live" | "none" (no prior approved baseline)
    kind: str
    revision_id: str | None = None
    rev_number: int | None = None
    label: str | None = None
    # Set when the baseline lives in another project (the clone parent), so the UI
    # can show which sequence it came from.
    project_id: str | None = None


class DiffSummary(BaseModel):
    added: int
    removed: int
    modified: int
    unchanged: int
    # Headline deltas (base vs target) — drive the Compare-tab summary strip.
    base_count: int = 0
    target_count: int = 0
    base_readiness_pct: int | None = None
    target_readiness_pct: int | None = None
    base_start: str | None = None
    base_end: str | None = None
    target_start: str | None = None
    target_end: str | None = None
    start_shift_days: int | None = None
    end_shift_days: int | None = None
    base_duration_days: int | None = None
    target_duration_days: int | None = None
    duration_shift_days: int | None = None


class ContractDiff(BaseModel):
    """Rig-level contract change (status / dates), deduped across activities."""

    rig_name: str
    fields: list[FieldChange]


class RevisionDiffResponse(BaseModel):
    base: DiffSide
    target: DiffSide
    summary: DiffSummary
    activities: list[ActivityDiff]
    contracts: list[ContractDiff] = []
