# Spec: Per-project Planner Dashboard

**Status:** design spec — no code yet.
**Audience for the feature:** the **planner** (and any project member; read-only).
**One-liner:** an at-a-glance "is this plan healthy, ready, and approvable, and what
needs my attention?" view for a single project, computed entirely from data we
already store (no schema changes).

---

## 1. Goal & principles

- **Actionable over vanity.** Lead with an **exceptions watchlist**, not raw totals.
  Every number that implies a problem must drill through to the filtered list of the
  offending activities.
- **Time-relative.** All "soon / overdue / expiring" metrics are computed against
  **today** (server date).
- **No new data capture.** Everything derives from existing entities: `Activity`,
  `ReadinessCheck`, `RigContract`, `Revision` / `RevisionSignature`, `ProjectApprover`.
- **Read-only.** No writes, no governance audit events.

---

## 2. Placement & navigation

A new project tab, **"Overview"**, added as the **left-most tab and the default
landing tab** when a project is opened (before "Sequence"). Existing tabs are
unchanged: Overview · Sequence · Activities · Readiness · Compare · Approvals ·
Activity Log.

---

## 3. Definitions (shared clock & windows)

- `today` = current server date (date, not datetime).
- **Near-term window** = `[today, today + NEAR_TERM_DAYS]`, default **90 days**
  (config constant). The watchlist also exposes 30/60/90 toggles in Phase 2.
- **Focus window** = the horizon the *attention* metrics (readiness, near-term,
  high-risk) are scoped to — default **next 12 months**, with a selector
  (90d / this year / 2y / all). This is a **10-year plan**, and far-future
  activities (a 2032 well) are *expected* to be unready, so scoping these metrics
  plan-wide would be meaningless noise. **Plan-wide** status metrics (approval,
  conflicts, total counts, contract expiry, overdue) ignore the focus window.
- An activity is **completed** when `completed_at is not null`.
- A readiness gate is **applicable** when its status ≠ `N/A`.
- An activity is **ready** when every applicable gate = `Completed`.
- A rig contract's dates are **binding** only when `status = "Completed"` (per the
  `RigContract` model note); non-binding contracts are excluded from contract KPIs.
- **Contract urgency** (binding contracts only, vs `contract_end`): `expired` (<0d),
  `critical` (0–29d), `soon` (30–89d), `healthy` (≥90d). Thresholds must match
  `frontend/src/lib/contract-urgency.ts` — keep them in sync.

---

## 4. KPI catalog

### 4a. Hero tiles (top row — the 4 MVP numbers)

> **No "Plan position" tile.** A campaign-progress headline isn't meaningful from a
> single quarterly project: cloning drops completed activities (§4d), so a count
> resets each quarter and the span is just calendar context. Progress lives instead
> in the activity stats (completed-this-quarter) and the lineage rollups (§4e).
>
> **No "Rig conflicts" tile.** Conflicts are hard-blocked at revision submission
> (409, `detect_rig_conflicts`) and flagged on the chart (red outline + banner)
> during drafting, so a tile would read 0 for any submittable/approved plan — low
> signal. Conflicts appear instead only as a *conditional* watchlist row (§4b),
> shown while drafting.

| # | Tile | Definition | States (color) | Drill-through |
|---|---|---|---|---|
| 1 | **Readiness (focus window)** | Overall % = `Completed cells / applicable cells` across activities **starting within the focus window** (far-future readiness is expected-incomplete, so a plan-wide % is meaningless). Sub-stat: **Behind** cells. | green ≥80 / amber 50–79 / red <50 | Readiness |
| 2 | **Approval status** | Status of the latest revision → `Draft` (none pending) / `Pending approval` / `Approved` / `Changes requested` / `Rejected`. For pending: "signed S of N". | red=Changes/Rejected, amber=Pending, green=Approved, neutral=Draft | Approvals |
| 3 | **Rigs in use** | distinct `rig_name` among non-completed activities; sub-stat = total **idle rig-days** (gaps between consecutive jobs — §4d). | neutral | Sequence |
| 4 | **Contracts at risk** | # of binding contracts that are `expired`+`critical`+`soon`. | red if any expired/critical, amber if soon, green if none | (contracts panel) |

### 4b. "Needs attention" watchlist (the core of the dashboard)

Each row: a count + short label + drill-through to the **filtered** activity list.
Hidden when count = 0 (so an empty watchlist visibly means "all clear").

| Item | Definition |
|---|---|
| ⭐ **Near-term, not ready** | activities with `start_date ∈ near-term window` that are **not ready** (≥1 applicable gate ≠ Completed). Sort by start date. *(Highest-value signal.)* |
| **Overdue** | `end_date < today` AND not completed. |
| **Conflicts blocking submission** *(optional)* | same-rig overlapping non-completed activities (`detect_rig_conflicts`). Shown **only while drafting** as a landing-page heads-up; already hard-blocked at submission and flagged on the chart, so this row is optional and can be dropped. |
| ⭐ **Past contract coverage** | non-completed activities whose `end_date > rig's binding contract_end`. |
| **Contracts expiring** | binding contracts with urgency `soon`/`critical`/`expired` (grouped). |
| **High-risk & near-term** | `risk = High` AND `start_date ∈ near-term window`. |
| **Stale approval** | a revision `pending_approval` for > `STALE_APPROVAL_DAYS` (default 7). |
| **Drift since approved** | # activities changed vs the last approved revision (reuse changes-since-approved diff). Shown only if a prior approved revision exists. |

### 4c. Breakdown charts (Phase 2 — also the "presentation" view)

- **Readiness by gate** — for each of BUD/LLI/LOC/FID/EIA/FLOOD/SUBS/CON, a stacked
  bar of statuses; surfaces the **top blocking gate** (most `Behind`).
- **Plan firmness** — Firm / Option / Out of Plan split (count or rig-days).
- **Activity-type mix** — counts by activity type (reuse `chart-colors`).
- **Rig idle gaps** — idle days between consecutive jobs, per rig. (We can compute
  busy days and gaps, but there's **no reliable availability denominator** in the
  data for a true "utilization %" — §4d.)

### 4d. Derived-metric formulas (the non-obvious ones)

- **Schedule progress** — there is **no clean count-based "% complete"** for a single
  project: the clone drops completed activities
  (`projects.py`: `if src.completed_at is not None: continue`), so `completed` resets
  to 0 each quarter and the denominator (remaining plan) shrinks. Use instead:
  **completed-this-quarter** (this project's `completed_at` count) and **overdue**
  (adherence — §4b). The drop is safe for
  reporting: completed activities persist in the prior (archived, not deleted)
  quarterly projects, so the lineage retains full history — **completed YTD** and a
  real cumulative campaign % are lineage aggregations across `cloned_from_project_id`
  (§4e).
- **Rig idle days** (per rig): order that rig's activities by `start_date`; sum the
  positive gaps between each activity's `end_date` and the next `start_date`.
  `busy_days` = sum of activity durations (no overlap to dedupe — conflicts are
  blocked). We deliberately **do not publish a "utilization %"**: the data has no
  reliable rig-availability denominator (verified — no availability/capacity table;
  `RigContract.contract_start/end` are optional + nullable, so a contract-window
  utilization is undefined for most rigs, and a campaign-span denominator misleads
  for rigs deployed in only part of the campaign). Idle days need only activity
  dates and are the actionable cost signal.
- **Top blocking gate**: `argmax over gate of count(activities where gate = Behind)`.
- **Drift since approved**: count of activities whose snapshot in the latest
  `approved` revision differs from the current activity (added / removed / changed),
  via the existing revision-diff logic.

### 4e. Stretch (Phase 3): campaign rollups via lineage

Walk the `Project.cloned_from_project_id` chain to compute what a single quarterly
project can't (completed activities live in the *prior* projects they were closed in):
- **Completed YTD** — activities with `completed_at` in `[Jan 1 this year, today]`,
  summed across this year's lineage projects (≤4 quarters → bounded walk). Each
  completed activity lives in exactly one project, so no double-counting.
- **Cumulative campaign progress** — total activities completed across all quarters
  vs the original baseline plan size → a real "% of the 10-year plan delivered."
- **vs-last-quarter deltas** — readiness %, activity count, overdue (▲/▼) vs the
  immediate parent. Only when a parent exists.

---

## 5. API & computation

**Recommended: one server-side summary endpoint** (keeps the logic testable, in the
service layer, and consistent — not recomputed across the client).

```
GET /api/projects/{project_id}/dashboard  ->  200 DashboardResponse
```

New service `app/services/dashboard.py::build_dashboard(project_id, db)` composes the
existing pieces (`conflicts.detect_rig_conflicts`, the revision-diff service, contract
urgency) plus the readiness/activity aggregations above. Response shape (Pydantic):

```jsonc
{
  "generated_at": "2026-05-31",
  "activities": { "total": 90, "completed": 31, "overdue": 4,
                  "starting_soon": 7, "by_plan_type": {"Firm": 60, "Option": 20, "Out of Plan": 10} },
  "readiness":  { "overall_pct": 62, "behind_cells": 9, "ready_activities": 18,
                  "top_blocking_gate": {"code": "FID", "behind": 6},
                  "by_gate": [{"code": "BUD", "completed": 70, "in_progress": 10, ...}] },
  "rigs":       { "in_use": 12, "conflicts": 0, "total_idle_days": 340,
                  "per_rig": [{"rig": "Land Rig 1", "busy_days": 300, "idle_days": 120}] },
  "contracts":  { "expired": 0, "critical": 1, "soon": 2, "healthy": 9,
                  "activities_past_contract": 3 },
  "approval":   { "current_status": "pending_approval", "signed": 1, "approvers": 3,
                  "pending_days": 5, "drift_since_approved": 12 },
  "risk":       { "high": 8, "high_near_term": 2 },
  "watchlist":  { "near_term_not_ready": 3, "overdue": 4, "past_contract": 3,
                  "contracts_expiring": 3, "high_risk_near_term": 2, "stale_approval": 0,
                  "drift_since_approved": 12 }
}
```

Watchlist drill-throughs are handled client-side: each item links to the
Activities/Sequence tab with the corresponding filter (no extra endpoints).

*Alternative considered:* compute client-side from already-fetched
activities/readiness/contracts. Rejected for the MVP — it would duplicate the
rig-conflict and revision-diff logic on the client and re-fetch the readiness map.

---

## 6. Security & access

- **AuthZ:** read endpoint — gate with `assert_member(project_id, user, db)` (any
  role, **including viewer**; no role restriction for read). Global admin bypass
  preserved via the helper.
- **BOLA:** every aggregate is scoped to `project_id`; no cross-project leakage.
- **Read-only:** no writes, **no governance audit event** required.
- **Fail safe:** generic `HTTPException` messages; never leak whether a project
  exists to a non-member (the `assert_member` denial already returns "Access denied").

---

## 7. Empty / edge states

- **No activities:** show an empty-state ("Add activities to see your dashboard"),
  hide tiles that divide by zero (progress, readiness, utilization).
- **No approvers configured:** Approval tile shows "No approvers configured" (ties to
  the rule that zero approvers never auto-approves).
- **No contracts:** hide the contracts tile + contract watchlist items.
- **All complete:** progress 100%, empty watchlist (the "all clear" state).
- **No prior approved revision:** hide "Drift since approved".

---

## 8. Phasing

- **MVP (Phase 1):** the 4 hero tiles + the watchlist + the `dashboard` endpoint.
  This is the high-value core.
- **Phase 2:** the 4 breakdown charts (doubles as the presentation view) + 30/60/90
  watchlist toggle.
- **Phase 3:** vs-last-quarter deltas via project lineage.

---

## 9. Acceptance criteria & tests

**Backend (`backend/tests/test_dashboard.py`):**
- A **non-member is denied** (403/"Access denied") — the required negative test.
- Counts are correct for a seeded fixture: overdue, starting_soon, conflicts (one
  overlapping pair → 1), readiness overall %, activities_past_contract, drift.
- Edge cases: empty project (no divide-by-zero), no approvers, no contracts.
- Contract urgency buckets match the threshold definitions.

**Frontend:**
- Tiles render the endpoint values; watchlist rows hidden at count 0; each row links
  to the right filtered tab; empty-state renders with no activities.

---

## 10. Open questions / config knobs

1. **`NEAR_TERM_DAYS`** default — proposing **90**. Confirm (drilling lead times vary).
2. **`STALE_APPROVAL_DAYS`** default — proposing **7**.
3. **(Resolved) Rig utilization %** — dropped. The data has no reliable rig-
   availability denominator, so we surface **idle rig-days** (gaps between jobs),
   which need only activity dates. A contract-window utilization could be added
   later, but only for rigs that have both contract dates *and* binding status.
4. Should "Overdue" count an activity whose readiness is fully done but `end_date`
   passed (i.e., probably finished but not marked complete)? Proposing: yes, still
   overdue — it nudges the planner to mark it complete.
5. **Focus window** default for the attention/readiness metrics — proposing **12
   months**, with a 90d / this-year / 2y / all selector. (Plan-wide readiness over
   10 years is noise.)
