"""Per-project planner dashboard — read-only KPI aggregation.

All metrics derive from existing data via the ORM (no raw SQL, no schema changes).
See docs/project-dashboard-spec.md for definitions. Phase 1: hero tiles + watchlist.
"""
import json
import uuid
from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.approver import ProjectApprover
from app.models.readiness import ReadinessCheck
from app.models.revision import Revision
from app.models.rig_contract import RigContract
from app.schemas.dashboard import (
    ActivityStats,
    ApprovalStats,
    ContractStats,
    DashboardResponse,
    ReadinessStats,
    RigDetail,
    RigStats,
    RiskStats,
    Watchlist,
)
from app.services.conflicts import detect_rig_conflicts
from app.services.revision_diff import diff_snapshots
from app.services.snapshot import build_project_snapshot

# Config knobs (defaults; see spec §10).
NEAR_TERM_DAYS = 90
FOCUS_WINDOW_DAYS = 365
STALE_APPROVAL_DAYS = 7

# Contract urgency thresholds — kept in sync with frontend/src/lib/contract-urgency.ts.
_CRITICAL_DAYS = 30
_SOON_DAYS = 90


async def build_dashboard(project_id: uuid.UUID, db: AsyncSession) -> DashboardResponse:
    today = date.today()
    near_term_end = today + timedelta(days=NEAR_TERM_DAYS)
    focus_end = today + timedelta(days=FOCUS_WINDOW_DAYS)

    activities = (
        await db.execute(select(Activity).where(Activity.project_id == project_id))
    ).scalars().all()

    # readiness map: activity_id -> {check_code: status}
    readiness_by_activity: dict[uuid.UUID, dict[str, str]] = {}
    if activities:
        act_ids = [a.id for a in activities]
        rows = (
            await db.execute(
                select(ReadinessCheck).where(ReadinessCheck.activity_id.in_(act_ids))
            )
        ).scalars().all()
        for r in rows:
            readiness_by_activity.setdefault(r.activity_id, {})[r.check_code] = r.status

    contracts = (
        await db.execute(select(RigContract).where(RigContract.project_id == project_id))
    ).scalars().all()

    revisions = (
        await db.execute(
            select(Revision)
            .where(Revision.project_id == project_id)
            .order_by(Revision.rev_number.desc())
        )
    ).scalars().all()

    approver_count = (
        await db.execute(
            select(func.count())
            .select_from(ProjectApprover)
            .where(ProjectApprover.project_id == project_id)
        )
    ).scalar_one()

    # ── helpers ────────────────────────────────────────────────────────────────
    def done(a: Activity) -> bool:
        return a.completed_at is not None

    def near_term(a: Activity) -> bool:
        return today <= a.start_date <= near_term_end

    def ready(a: Activity) -> bool:
        # Ready = has ≥1 applicable (non-N/A) gate AND all applicable gates Completed.
        # An activity with no readiness set is therefore *not* ready — for a
        # near-term activity that's a legitimate "set your gates" nudge.
        applicable = [s for s in readiness_by_activity.get(a.id, {}).values() if s != "N/A"]
        return bool(applicable) and all(s == "Completed" for s in applicable)

    # ── activities ─────────────────────────────────────────────────────────────
    overdue = sum(1 for a in activities if not done(a) and a.end_date < today)
    by_plan_type: dict[str, int] = {}
    for a in activities:
        key = a.plan_type or "Unspecified"
        by_plan_type[key] = by_plan_type.get(key, 0) + 1
    activity_stats = ActivityStats(
        total=len(activities),
        completed_this_quarter=sum(1 for a in activities if done(a)),
        overdue=overdue,
        starting_soon=sum(1 for a in activities if not done(a) and near_term(a)),
        by_plan_type=by_plan_type,
    )

    # ── readiness (focus window) ───────────────────────────────────────────────
    focus = [a for a in activities if not done(a) and a.start_date <= focus_end]
    applicable_cells = completed_cells = behind_cells = 0
    for a in focus:
        for s in readiness_by_activity.get(a.id, {}).values():
            if s == "N/A":
                continue
            applicable_cells += 1
            if s == "Completed":
                completed_cells += 1
            elif s == "Behind":
                behind_cells += 1
    readiness_stats = ReadinessStats(
        focus_count=len(focus),
        overall_pct=round(100 * completed_cells / applicable_cells) if applicable_cells else None,
        behind_cells=behind_cells,
        ready=sum(1 for a in focus if ready(a)),
    )

    # ── rigs ───────────────────────────────────────────────────────────────────
    conflicts = detect_rig_conflicts(activities)
    by_rig: dict[str, list[Activity]] = {}
    for a in activities:
        if a.rig_name:
            by_rig.setdefault(a.rig_name, []).append(a)
    per_rig: list[RigDetail] = []
    total_idle = 0
    for rig, acts in by_rig.items():
        seq = sorted(acts, key=lambda x: x.start_date)
        busy = sum((x.end_date - x.start_date).days for x in seq)
        idle = sum(
            max(0, (nxt.start_date - prev.end_date).days) for prev, nxt in zip(seq, seq[1:])
        )
        total_idle += idle
        per_rig.append(RigDetail(rig=rig, busy_days=busy, idle_days=idle))
    per_rig.sort(key=lambda r: r.idle_days, reverse=True)
    rig_stats = RigStats(
        in_use=len({a.rig_name for a in activities if a.rig_name and not done(a)}),
        conflicts=len(conflicts),
        total_idle_days=total_idle,
        per_rig=per_rig,
    )

    # ── contracts (binding = status Completed, with an end date) ────────────────
    buckets = {"expired": 0, "critical": 0, "soon": 0, "healthy": 0}
    contract_end_by_rig: dict[str, date] = {}
    for c in contracts:
        if c.status != "Completed" or c.contract_end is None:
            continue
        contract_end_by_rig[c.rig_name] = c.contract_end
        d = (c.contract_end - today).days
        if d < 0:
            buckets["expired"] += 1
        elif d < _CRITICAL_DAYS:
            buckets["critical"] += 1
        elif d < _SOON_DAYS:
            buckets["soon"] += 1
        else:
            buckets["healthy"] += 1
    activities_past_contract = sum(
        1
        for a in activities
        if not done(a)
        and a.rig_name in contract_end_by_rig
        and a.end_date > contract_end_by_rig[a.rig_name]
    )
    contract_stats = ContractStats(**buckets, activities_past_contract=activities_past_contract)
    contracts_expiring = buckets["expired"] + buckets["critical"] + buckets["soon"]

    # ── approval ───────────────────────────────────────────────────────────────
    latest = revisions[0] if revisions else None
    pending = bool(latest) and latest.status == "pending_approval"
    pending_days = (today - latest.created_at.date()).days if pending else None
    stale = 1 if (pending_days is not None and pending_days > STALE_APPROVAL_DAYS) else 0

    drift: int | None = None
    last_approved = next((r for r in revisions if r.status == "approved"), None)
    if last_approved is not None:
        base = json.loads(last_approved.snapshot_json)
        current = await build_project_snapshot(project_id, db)
        summary = diff_snapshots(base, current, match_by="id")["summary"]
        drift = summary["added"] + summary["removed"] + summary["modified"]

    approval_stats = ApprovalStats(
        current_status=latest.status if latest else "draft",
        signed=len(latest.signatures) if pending else 0,
        approvers=approver_count,
        pending_days=pending_days,
        drift_since_approved=drift,
    )

    # ── risk ───────────────────────────────────────────────────────────────────
    high_near_term = sum(
        1 for a in activities if a.risk == "High" and not done(a) and near_term(a)
    )
    risk_stats = RiskStats(
        high=sum(1 for a in activities if a.risk == "High"),
        high_near_term=high_near_term,
    )

    # ── watchlist ──────────────────────────────────────────────────────────────
    watchlist = Watchlist(
        near_term_not_ready=sum(
            1 for a in activities if not done(a) and near_term(a) and not ready(a)
        ),
        overdue=overdue,
        past_contract=activities_past_contract,
        contracts_expiring=contracts_expiring,
        high_risk_near_term=high_near_term,
        stale_approval=stale,
        conflicts=len(conflicts),
        drift_since_approved=drift or 0,
    )

    return DashboardResponse(
        generated_at=today,
        activities=activity_stats,
        readiness=readiness_stats,
        rigs=rig_stats,
        contracts=contract_stats,
        approval=approval_stats,
        risk=risk_stats,
        watchlist=watchlist,
    )
