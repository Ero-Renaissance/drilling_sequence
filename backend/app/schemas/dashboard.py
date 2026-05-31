"""Response schema for the per-project planner dashboard (read-only).

All values are derived from existing data (activities, readiness checks, rig
contracts, revisions). See docs/project-dashboard-spec.md.
"""
from datetime import date

from pydantic import BaseModel


class ActivityStats(BaseModel):
    total: int
    completed_this_quarter: int  # this project's completed_at count (clone drops these next quarter)
    overdue: int  # end_date < today and not completed
    starting_soon: int  # start within the near-term window, not completed
    by_plan_type: dict[str, int]


class ReadinessStats(BaseModel):
    focus_count: int  # activities considered (focus window, not completed)
    overall_pct: int | None  # Completed cells / applicable cells, across focus activities
    behind_cells: int
    ready: int  # focus activities with all applicable gates Completed


class RigDetail(BaseModel):
    rig: str
    busy_days: int
    idle_days: int


class RigStats(BaseModel):
    in_use: int
    conflicts: int
    total_idle_days: int
    per_rig: list[RigDetail]


class ContractStats(BaseModel):
    expired: int
    critical: int
    soon: int
    healthy: int
    activities_past_contract: int


class ApprovalStats(BaseModel):
    current_status: str  # draft | pending_approval | approved | changes_requested | rejected | discarded
    signed: int
    approvers: int
    pending_days: int | None
    drift_since_approved: int | None


class RiskStats(BaseModel):
    high: int
    high_near_term: int


class Watchlist(BaseModel):
    near_term_not_ready: int
    overdue: int
    past_contract: int
    contracts_expiring: int
    high_risk_near_term: int
    stale_approval: int
    conflicts: int
    drift_since_approved: int


class DashboardResponse(BaseModel):
    generated_at: date
    activities: ActivityStats
    readiness: ReadinessStats
    rigs: RigStats
    contracts: ContractStats
    approval: ApprovalStats
    risk: RiskStats
    watchlist: Watchlist
