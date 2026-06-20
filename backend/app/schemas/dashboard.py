"""Response schema for the per-project planner dashboard (read-only).

All values are derived from existing data (activities, readiness checks, rig
contracts, revisions). See docs/project-dashboard-spec.md.
"""
import uuid
from datetime import date, datetime

from pydantic import BaseModel


class ActivityStats(BaseModel):
    total: int
    # this project's completed_at count (clone drops these next quarter)
    completed_this_quarter: int
    completed_ytd: int  # completed this calendar year across the clone lineage
    overdue: int  # end_date < today and not completed
    starting_soon: int  # start within the near-term window, not completed
    by_plan_type: dict[str, int]
    by_activity_type: dict[str, int]  # plan composition (all activities)


class GateBreakdown(BaseModel):
    code: str
    completed: int
    in_progress: int
    not_started: int
    behind: int
    na: int


class ReadinessStats(BaseModel):
    focus_count: int  # activities considered (focus window, not completed)
    overall_pct: int | None  # Completed cells / applicable cells, across focus activities
    behind_cells: int
    ready: int  # focus activities with all applicable gates Completed
    by_gate: list[GateBreakdown]  # status split per gate, over focus activities


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
    # draft | pending_approval | approved | changes_requested | rejected | discarded
    current_status: str
    signed: int
    approvers: int
    pending_days: int | None
    drift_since_approved: int | None


class RiskStats(BaseModel):
    flood: int
    flood_near_term: int


class Watchlist(BaseModel):
    near_term_not_ready: int
    overdue: int
    past_contract: int
    contracts_expiring: int
    flood_risk_near_term: int
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


# ── Home dashboard: the most-recently-approved sequence (snapshot-derived) ──────


class LastApprovedKPIs(BaseModel):
    """Hero-tile KPIs computed from an approved revision's frozen snapshot.

    Mirrors the per-project Overview, minus the metrics that don't translate to a
    snapshot (Completed-YTD is a live metric; conflicts are always 0 in an
    approved plan). Time-relative figures (readiness focus window, contracts at
    risk) are still evaluated against today."""

    activities_total: int
    schedule_start: str | None = None
    schedule_end: str | None = None
    readiness_pct: int | None = None  # Completed / applicable cells over the focus window
    readiness_focus_count: int = 0
    rigs_in_use: int = 0
    contracts_at_risk: int = 0  # rigs whose contract is expired or expiring < 90 days
    by_gate: list[GateBreakdown] = []


class LastApprovedDashboard(BaseModel):
    """Home KPIs from the caller's most-recently-approved revision. `available`
    is False when the caller has no approved revision in any of their projects."""

    available: bool
    project_id: uuid.UUID | None = None
    project_name: str | None = None
    rev_number: int | None = None
    rev_label: str | None = None
    approved_at: datetime | None = None
    approved_by: str | None = None
    kpis: LastApprovedKPIs | None = None
