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
from app.models.hwu_contract import HwuContract
from app.models.project import Project
from app.models.readiness import CHECK_CODES, ReadinessCheck
from app.models.resource_registry import ResourceRecord, normalize_resource_name
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
from app.services.conflicts import detect_resource_conflicts
from app.services.revision_diff import diff_snapshots
from app.services.snapshot import build_project_snapshot

# Readiness status string → GateBreakdown field.
_STATUS_KEY = {
    "Completed": "completed",
    "On Track": "on_track",
    "Behind": "behind",
    "N/A": "na",
}

# Config knobs (defaults; see spec §10).
NEAR_TERM_DAYS = 90
FOCUS_WINDOW_DAYS = 365
STALE_APPROVAL_DAYS = 7

# Contract urgency thresholds — kept in sync with frontend/src/lib/contract-urgency.ts.
# Keyed to the QUARTERLY approval cadence: "soon" = two approval cycles left,
# "critical" = less than one cycle left (this sitting is the last chance to act).
_CRITICAL_DAYS = 90
_SOON_DAYS = 180

# How far ahead a placeholder slot with scheduled work counts as a procurement
# alert — rig tendering realistically takes most of a year.
_PROCUREMENT_LOOKAHEAD_DAYS = 270


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
    hwu_contracts = (
        await db.execute(select(HwuContract).where(HwuContract.project_id == project_id))
    ).scalars().all()
    placeholder_units = (
        await db.execute(
            select(ResourceRecord).where(
                ResourceRecord.project_id == project_id,
                ResourceRecord.is_placeholder.is_(True),
            )
        )
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
    # Activities that opt out (readiness_required=False) track no gates, so they
    # are excluded from every readiness KPI below.
    focus = [
        a
        for a in activities
        if not done(a) and a.start_date <= focus_end and a.readiness_required
    ]
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
    # Per-gate status split across the focus activities — surfaces the top
    # blocking gate. A gate with no row reads as its default, "On Track".
    gate_buckets = {
        c: {"completed": 0, "on_track": 0, "behind": 0, "na": 0}
        for c in CHECK_CODES
    }
    for a in focus:
        checks = readiness_by_activity.get(a.id, {})
        for c in CHECK_CODES:
            gate_buckets[c][_STATUS_KEY.get(checks.get(c, "On Track"), "on_track")] += 1

    readiness_stats = ReadinessStats(
        focus_count=len(focus),
        overall_pct=round(100 * completed_cells / applicable_cells) if applicable_cells else None,
        behind_cells=behind_cells,
        ready=sum(1 for a in focus if ready(a)),
        by_gate=[GateBreakdown(code=c, **gate_buckets[c]) for c in CHECK_CODES],
    )

    # ── rigs ───────────────────────────────────────────────────────────────────
    # Rig identity is (terrain, name) — the same name in two terrains is two
    # physical rigs (see app/services/conflicts.py), so utilisation/idle stats
    # are computed per lane and labelled "TERRAIN – Rig".
    conflicts = detect_resource_conflicts(activities)
    # Lanes keyed like the registry (stripped terrain, normalized name) so casing
    # variants of one physical rig share one utilisation lane; the label keeps
    # the first casing the schedule uses.
    by_rig: dict[tuple[str, str], list[Activity]] = {}
    for a in activities:
        if a.rig_name:
            key = ((a.location or "").strip(), normalize_resource_name(a.rig_name))
            by_rig.setdefault(key, []).append(a)
    per_rig: list[RigDetail] = []
    total_idle = 0
    for (loc, _name_key), acts in by_rig.items():
        seq = sorted(acts, key=lambda x: x.start_date)
        busy = sum((x.end_date - x.start_date).days for x in seq)
        idle = sum(
            max(0, (nxt.start_date - prev.end_date).days) for prev, nxt in zip(seq, seq[1:])
        )
        total_idle += idle
        rig = (seq[0].rig_name or "").strip()
        per_rig.append(
            RigDetail(rig=f"{loc} – {rig}" if loc else rig, busy_days=busy, idle_days=idle)
        )
    per_rig.sort(key=lambda r: r.idle_days, reverse=True)

    # Fleet demand split kind × procurement: units with live work, keyed like
    # the registry ((terrain, name_key) for rigs; name_key for mobile HWUs) so
    # casing variants collapse to one physical unit. A unit the registry marks
    # as a placeholder is "planned" capacity; anything else (including a unit
    # somehow unregistered) counts as procured.
    registry = (
        await db.execute(
            select(ResourceRecord).where(ResourceRecord.project_id == project_id)
        )
    ).scalars().all()
    planned_rig_keys = {
        (r.terrain, r.name_key) for r in registry if r.kind == "rig" and r.is_placeholder
    }
    planned_hwu_keys = {r.name_key for r in registry if r.kind == "hwu" and r.is_placeholder}
    live_rig_keys = {
        ((a.location or "").strip(), normalize_resource_name(a.rig_name))
        for a in activities
        if a.rig_name and not done(a)
    }
    live_hwu_keys = {
        normalize_resource_name(a.hwu_name) for a in activities if a.hwu_name and not done(a)
    }

    rig_stats = RigStats(
        in_use=len(live_rig_keys - planned_rig_keys),
        hwus_in_use=len(live_hwu_keys - planned_hwu_keys),
        planned_rigs=len(live_rig_keys & planned_rig_keys),
        planned_hwus=len(live_hwu_keys & planned_hwu_keys),
        conflicts=len(conflicts),
        total_idle_days=total_idle,
        per_rig=per_rig,
    )

    # ── contracts (a contract IS its end date) ──────────────────────────────────
    # Rig and HWU contracts are pooled — both are resource contracts at risk.
    buckets = {"expired": 0, "critical": 0, "soon": 0, "healthy": 0}

    def _bucket_expiry(end: date) -> None:
        d = (end - today).days
        if d < 0:
            buckets["expired"] += 1
        elif d < _CRITICAL_DAYS:
            buckets["critical"] += 1
        elif d < _SOON_DAYS:
            buckets["soon"] += 1
        else:
            buckets["healthy"] += 1

    # Keyed like the registry (normalized name; stripped terrain for rigs) so a
    # contract saved as "10K Rig 1" still matches an activity typed "10k rig 1".
    contract_end_by_rig: dict[tuple[str, str], date] = {}
    for c in contracts:
        if c.contract_end is not None:
            # Rig contracts are per PHYSICAL unit: keyed (name, terrain); "" is
            # the legacy/unassigned sentinel and matches any terrain (fallback).
            key = (normalize_resource_name(c.rig_name), (c.terrain or "").strip())
            contract_end_by_rig[key] = c.contract_end
            _bucket_expiry(c.contract_end)
    contract_end_by_hwu: dict[str, date] = {}
    for c in hwu_contracts:
        if c.contract_end is not None:
            contract_end_by_hwu[normalize_resource_name(c.hwu_name)] = c.contract_end
            _bucket_expiry(c.contract_end)

    def _rig_contract_end(a: Activity) -> date | None:
        if not a.rig_name:
            return None
        name_key = normalize_resource_name(a.rig_name)
        return contract_end_by_rig.get(
            (name_key, (a.location or "").strip())
        ) or contract_end_by_rig.get((name_key, ""))

    def _hwu_contract_end(a: Activity) -> date | None:
        if not a.hwu_name:
            return None
        return contract_end_by_hwu.get(normalize_resource_name(a.hwu_name))

    activities_past_contract = sum(
        1
        for a in activities
        if not done(a)
        and (
            ((rig_end := _rig_contract_end(a)) is not None and a.end_date > rig_end)
            or ((hwu_end := _hwu_contract_end(a)) is not None and a.end_date > hwu_end)
        )
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
    # Procurement early warning: a PLACEHOLDER unit (planned slot, no awarded
    # rig behind it) whose lane has work starting within the procurement
    # lead-time window. Complements contract expiry: that warns about contracts
    # ending; this warns about contracts that don't exist yet.
    procurement_end = today + timedelta(days=_PROCUREMENT_LOOKAHEAD_DAYS)
    slot_keys = {(u.kind, u.terrain, u.name_key) for u in placeholder_units}

    def _lane_key(a: Activity) -> tuple[str, str, str] | None:
        if a.rig_name:
            return ("rig", (a.location or "").strip(), a.rig_name.strip().lower())
        if a.hwu_name:
            return ("hwu", "", a.hwu_name.strip().lower())
        return None

    unprocured_slots = len(
        {
            _lane_key(a)
            for a in activities
            if not done(a)
            and today <= a.start_date <= procurement_end
            and _lane_key(a) in slot_keys
        }
    )

    watchlist = Watchlist(
        near_term_not_ready=sum(
            1
            for a in activities
            if not done(a) and near_term(a) and a.readiness_required and not ready(a)
        ),
        overdue=overdue,
        past_contract=activities_past_contract,
        contracts_expiring=contracts_expiring,
        flood_risk_near_term=flood_near_term,
        stale_approval=stale,
        conflicts=len(conflicts),
        drift_since_approved=drift or 0,
        unprocured_slots=unprocured_slots,
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
        if not is_done(a)
        and a.get("readiness_required", True)
        and (s := _snap_date(a.get("start_date")))
        and s <= focus_end
    ]

    applicable = completed = 0
    gate_buckets = {
        c: {"completed": 0, "on_track": 0, "behind": 0, "na": 0}
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
            gate_buckets[c][_STATUS_KEY.get(readiness.get(c, "On Track"), "on_track")] += 1

    # Contracts at risk — dedupe the denormalised contract per physical rig
    # (name + location, so terrain twins count separately).
    contract_end_by_rig: dict[tuple[str, str], date] = {}
    for a in snapshot:
        rig = a.get("rig_name")
        # Normalized like the registry, so casing variants of one physical rig
        # dedupe to one contract (matching how the snapshot resolved them).
        key = ((rig or "").strip().lower(), (a.get("location") or "").strip())
        if not rig or key in contract_end_by_rig:
            continue
        # Historical snapshots may carry the retired workflow status; a "Draft"
        # contract's dates weren't binding when that revision was approved, so
        # stay faithful to it. Post-024 snapshots omit the key (None → binding).
        if a.get("rig_contract_status") in (None, "Completed") and (
            end := _snap_date(a.get("rig_contract_end"))
        ):
            contract_end_by_rig[key] = end
    contracts_at_risk = sum(
        1 for end in contract_end_by_rig.values() if (end - today).days < _SOON_DAYS
    )

    # Fleet demand split (mirrors RigStats): per PHYSICAL unit — rigs keyed
    # (terrain, name) so terrain twins count separately, HWUs by name. The
    # snapshot's resource_planned flag splits procured vs planned; snapshots
    # predating the flag report everything as in use.
    live = [a for a in snapshot if not is_done(a)]

    def _rig_key(a: dict) -> tuple[str, str]:
        return ((a.get("location") or "").strip(), (a.get("rig_name") or "").strip().lower())

    rig_keys = {_rig_key(a) for a in live if a.get("rig_name")}
    planned_rig_keys = {
        _rig_key(a) for a in live if a.get("rig_name") and a.get("resource_planned")
    }
    hwu_keys = {(a.get("hwu_name") or "").strip().lower() for a in live if a.get("hwu_name")}
    planned_hwu_keys = {
        (a.get("hwu_name") or "").strip().lower()
        for a in live
        if a.get("hwu_name") and a.get("resource_planned")
    }

    return LastApprovedKPIs(
        activities_total=len(snapshot),
        schedule_start=min(starts).isoformat() if starts else None,
        schedule_end=max(ends).isoformat() if ends else None,
        readiness_pct=round(100 * completed / applicable) if applicable else None,
        readiness_focus_count=len(focus),
        rigs_in_use=len(rig_keys - planned_rig_keys),
        hwus_in_use=len(hwu_keys - planned_hwu_keys),
        planned_rigs=len(planned_rig_keys),
        planned_hwus=len(planned_hwu_keys),
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
