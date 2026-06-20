"""Per-project planner dashboard — read-only KPI aggregation.

All metrics derive from existing data via the ORM (no raw SQL, no schema changes).
See docs/project-dashboard-spec.md for definitions. Phase 1: hero tiles + watchlist.
"""
import json
import uuid
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.activity import Activity
from app.models.approver import ProjectApprover
from app.models.project import Project
from app.models.readiness import CHECK_CODES, ReadinessCheck
from app.models.revision import Revision, Signature
from app.models.rig_contract import RigContract
from app.schemas.dashboard import (
    ActivityStats,
    ApprovalStats,
    ContractStats,
    DashboardResponse,
    GateBreakdown,
    LastApprovedDashboard,
    LastApprovedKPIs,
    ReadinessStats,
    RigDetail,
    RigStats,
    RiskStats,
    Watchlist,
)
from app.services.conflicts import detect_rig_conflicts
from app.services.readiness import derive_con_status
from app.services.revision_diff import diff_snapshots
from app.services.snapshot import build_project_snapshot

# Readiness status string → GateBreakdown field.
_STATUS_KEY = {
    "Completed": "completed",
    "In Progress": "in_progress",
    "Not Started": "not_started",
    "Behind": "behind",
    "N/A": "na",
}

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
    contracts_by_rig = {c.rig_name: c for c in contracts}

    # CON (Contract) readiness is derived from the rig contract, not stored as a
    # ReadinessCheck row. Inject it so the readiness %, the per-gate breakdown,
    # and the "ready" count all account for the contract gate — and agree with
    # the Readiness tab (which derives it the same way).
    for a in activities:
        readiness_by_activity.setdefault(a.id, {})["CON"] = derive_con_status(
            a, contracts_by_rig.get(a.rig_name)
        )

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
    # Completed YTD across the clone lineage. A completed activity lives in the
    # project it was closed in (the clone drops it next quarter), so summing
    # completed_at >= Jan 1 across this project + its ancestors counts each once.
    year_start = datetime(today.year, 1, 1, tzinfo=timezone.utc)
    lineage_ids: list[uuid.UUID] = []
    seen: set[uuid.UUID] = set()
    cursor: uuid.UUID | None = project_id
    while cursor is not None and cursor not in seen:
        seen.add(cursor)
        lineage_ids.append(cursor)
        ancestor = await db.get(Project, cursor)
        cursor = ancestor.cloned_from_project_id if ancestor else None
    completed_ytd = (
        await db.execute(
            select(func.count())
            .select_from(Activity)
            .where(
                Activity.project_id.in_(lineage_ids),
                Activity.completed_at >= year_start,
            )
        )
    ).scalar_one()

    overdue = sum(1 for a in activities if not done(a) and a.end_date < today)
    by_plan_type: dict[str, int] = {}
    by_activity_type: dict[str, int] = {}
    for a in activities:
        plan_key = a.plan_type or "Unspecified"
        by_plan_type[plan_key] = by_plan_type.get(plan_key, 0) + 1
        by_activity_type[a.activity_type] = by_activity_type.get(a.activity_type, 0) + 1
    activity_stats = ActivityStats(
        total=len(activities),
        completed_this_quarter=sum(1 for a in activities if done(a)),
        completed_ytd=completed_ytd,
        overdue=overdue,
        starting_soon=sum(1 for a in activities if not done(a) and near_term(a)),
        by_plan_type=by_plan_type,
        by_activity_type=by_activity_type,
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
    # Per-gate status split across the focus activities (each of the 8 gates ×
    # 5 statuses) — surfaces the top blocking gate. A gate with no row reads as
    # its default, "Not Started".
    gate_buckets = {
        c: {"completed": 0, "in_progress": 0, "not_started": 0, "behind": 0, "na": 0}
        for c in CHECK_CODES
    }
    for a in focus:
        checks = readiness_by_activity.get(a.id, {})
        for c in CHECK_CODES:
            gate_buckets[c][_STATUS_KEY.get(checks.get(c, "Not Started"), "not_started")] += 1

    readiness_stats = ReadinessStats(
        focus_count=len(focus),
        overall_pct=round(100 * completed_cells / applicable_cells) if applicable_cells else None,
        behind_cells=behind_cells,
        ready=sum(1 for a in focus if ready(a)),
        by_gate=[GateBreakdown(code=c, **gate_buckets[c]) for c in CHECK_CODES],
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

    # ── risk (flood) ─────────────────────────────────────────────────────────────
    flood_near_term = sum(
        1 for a in activities if a.risk == "Flood Risk" and not done(a) and near_term(a)
    )
    risk_stats = RiskStats(
        flood=sum(1 for a in activities if a.risk == "Flood Risk"),
        flood_near_term=flood_near_term,
    )

    # ── watchlist ──────────────────────────────────────────────────────────────
    watchlist = Watchlist(
        near_term_not_ready=sum(
            1 for a in activities if not done(a) and near_term(a) and not ready(a)
        ),
        overdue=overdue,
        past_contract=activities_past_contract,
        contracts_expiring=contracts_expiring,
        flood_risk_near_term=flood_near_term,
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


# ── Home dashboard: KPIs of the most-recently-approved sequence ─────────────────


def _snap_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def compute_snapshot_kpis(snapshot: list[dict], today: date) -> LastApprovedKPIs:
    """Hero-tile KPIs computed from a frozen revision snapshot (a list of activity
    dicts with readiness + denormalised contract fields). Mirrors the per-project
    Overview where the metrics translate to a snapshot; time-relative figures
    (focus window, contracts at risk) are still evaluated against `today`."""
    focus_end = today + timedelta(days=FOCUS_WINDOW_DAYS)

    starts = [d for a in snapshot if (d := _snap_date(a.get("start_date")))]
    ends = [d for a in snapshot if (d := _snap_date(a.get("end_date")))]

    def is_done(a: dict) -> bool:
        return bool(a.get("completed_at"))

    focus = [
        a
        for a in snapshot
        if not is_done(a) and (s := _snap_date(a.get("start_date"))) and s <= focus_end
    ]

    applicable = completed = 0
    gate_buckets = {
        c: {"completed": 0, "in_progress": 0, "not_started": 0, "behind": 0, "na": 0}
        for c in CHECK_CODES
    }
    for a in focus:
        readiness = a.get("readiness") or {}
        for status in readiness.values():
            if status == "N/A":
                continue
            applicable += 1
            if status == "Completed":
                completed += 1
        for c in CHECK_CODES:
            gate_buckets[c][_STATUS_KEY.get(readiness.get(c, "Not Started"), "not_started")] += 1

    # Contracts at risk — dedupe the denormalised contract by rig (one row per rig).
    contract_end_by_rig: dict[str, date] = {}
    for a in snapshot:
        rig = a.get("rig_name")
        if not rig or rig in contract_end_by_rig:
            continue
        if a.get("rig_contract_status") == "Completed" and (
            end := _snap_date(a.get("rig_contract_end"))
        ):
            contract_end_by_rig[rig] = end
    contracts_at_risk = sum(
        1 for end in contract_end_by_rig.values() if (end - today).days < _SOON_DAYS
    )

    return LastApprovedKPIs(
        activities_total=len(snapshot),
        schedule_start=min(starts).isoformat() if starts else None,
        schedule_end=max(ends).isoformat() if ends else None,
        readiness_pct=round(100 * completed / applicable) if applicable else None,
        readiness_focus_count=len(focus),
        rigs_in_use=len(
            {a.get("rig_name") for a in snapshot if a.get("rig_name") and not is_done(a)}
        ),
        contracts_at_risk=contracts_at_risk,
        by_gate=[GateBreakdown(code=c, **gate_buckets[c]) for c in CHECK_CODES],
    )


async def build_last_approved(
    project_ids: list[uuid.UUID], db: AsyncSession
) -> LastApprovedDashboard:
    """Find the most-recently-approved revision among `project_ids` and compute its
    snapshot KPIs. Approval time = the latest approval-stage signature (there is no
    explicit approved_at). Returns `available=False` when there's no approval."""
    if not project_ids:
        return LastApprovedDashboard(available=False)

    revs = (
        await db.execute(
            select(Revision)
            .where(Revision.project_id.in_(project_ids), Revision.status == "approved")
            .options(selectinload(Revision.signatures).selectinload(Signature.user))
        )
    ).scalars().all()
    if not revs:
        return LastApprovedDashboard(available=False)

    def approval_sigs(rev: Revision) -> list[Signature]:
        return [s for s in rev.signatures if s.stage == "approval"]

    def approved_at(rev: Revision) -> datetime:
        times = [s.signed_at for s in approval_sigs(rev)]
        return max(times) if times else rev.created_at

    best = max(revs, key=approved_at)
    last_sig = max(approval_sigs(best), key=lambda s: s.signed_at, default=None)
    project = await db.get(Project, best.project_id)

    return LastApprovedDashboard(
        available=True,
        project_id=best.project_id,
        project_name=project.name if project else None,
        rev_number=best.rev_number,
        rev_label=best.label,
        approved_at=approved_at(best),
        approved_by=last_sig.user.name if last_sig and last_sig.user else None,
        kpis=compute_snapshot_kpis(json.loads(best.snapshot_json), date.today()),
    )
