# Rig Fleet Optimization — Feature Specification

**Status:** agreed understanding, pre-implementation · **Date:** 2026-07-06
**Owner:** Osahon Ero · **Feature access:** planners and admins only (`can_plan` grant)

## 1. Purpose

Answer one question for drilling planners: **"What is the minimum number of rigs,
per terrain, that delivers the committed well count per project per year?"**

The tool takes a multi-year wells schedule (wells per project per year), applies the
agreed scheduling rules, and reports the smallest rig fleet for which no yearly
commitment slips — with the rig-by-rig schedule that proves it.

## 2. Scope

**In scope**
- Drilling rigs only. Fleet sizing per terrain, over a multi-year horizon.
- A what-if planning tool: it reads a schedule and computes; it does not modify
  campaigns, plans, or approvals.

**Out of scope (explicitly agreed)**
- Completion / hook-up time — **not part of the model** (dropped 2026-07-06;
  the earlier "completion holds the rig" variant, Scenario 2, is retired as inaccurate).
- HWUs — not part of this optimization.
- Rig-contract costs, day rates, or vendor selection — the answer is a count and a
  schedule, not a commercial recommendation.

## 3. Scheduling model (per the agreed "Scenario 1" worksheet)

### 3.1 Hard structural rules

1. **Terrains are sealed.** Rigs never cross terrains. Land, Swamp, and SWO are
   three fully independent optimizations.
2. **A rig works sequentially.** Each rig executes a chain of wells; a well occupies
   exactly one rig for its full duration.
3. **A rig can serve multiple projects back-to-back** within its terrain.

### 3.2 The rig chain

For a project's wells assigned to one rig (worked example, 6 wells):

```
Well 1 (2.5 mo) ── 2 wks ── Well 2 (2.5 mo) ── 2 wks ── Well 3 (2.5 mo) ── 4 wks ──
Well 4 (2.5 mo) ── 2 wks ── Well 5 (2.5 mo) ── 2 wks ── Well 6 (2.5 mo)
```

- **Well duration:** 2.5 months of rig time (drilling only).
- **Between consecutive wells in a project:** 2 weeks (rig move).
- **After every 3rd well in a project:** 4 weeks — this **replaces** that slot's
  2-week gap (batch boundary), it is not additive.
- **Between projects in the same terrain:** 45 days rig move.

Worked total: a 6-well project occupies one rig for **≈ 17.8 months**
(15.0 months drilling + 12 weeks of gaps), and that rig is available at its next
project 45 days after the last well.

### 3.3 Demand constraint

- The input schedule commits **wells per project per year**. Yearly targets are
  **hard**: a well committed to year Y must be delivered within year Y.
- Default definition of "delivered": the well's 2.5-month drilling window
  **finishes on or before 31 December of Y**. *(Configurable — see §5.)*

## 4. Inputs

### 4.1 Wells schedule

Grid with one row per project:

| Terrain | Project | 2027 | 2028 | 2029 | 2030 | 2031 |
|---|---|---|---|---|---|---|
| Land | Project 2 | 2 | 5 | | | |
| Swamp | Project 15 | 5 | 5 | 14 | 6 | |
| SWO | Project 19 | | 2 | 6 | 4 | |

- Terrain values: `Land`, `Swamp`, `SWO` (validated against this list).
- Year columns are dynamic (any contiguous horizon, not hardcoded 2027–2031).
- Two input paths, same grid: **upload** (CSV or Excel in exactly this layout)
  or **type it in** for quick what-ifs.

### 4.2 Assumptions (all editable in the frontend)

| Parameter | Default | Notes |
|---|---|---|
| Well duration | 2.5 months | per well, rig-occupying |
| Gap between wells | 2 weeks | within a project |
| Batch size | 3 wells | after which the batch gap applies |
| Gap after each batch | 4 weeks | replaces the inter-well gap at that slot |
| Move between projects | 45 days | same terrain |
| Rig availability | 12 months/year | derate here for maintenance if desired |

A saved set of these parameters is a **scenario**. The defaults above ship as the
built-in scenario ("Scenario 1"); planners can adjust values and compare runs.

## 5. Configurable relaxations (all OFF by default)

- **Allow slip:** permit a well to finish up to N weeks past year-end.
- **Allow drill-ahead:** permit drilling a well earlier than its committed year.
- **Delivery definition:** "finished in-year" (default) vs "spudded in-year".

## 6. Outputs

1. **Fleet answer per terrain:** minimum rig count, plus rigs required per year
   (the fleet profile), and the binding constraint ("2029 Land demand sets the fleet").
2. **Rig-by-rig schedule:** each rig's chain (wells, moves, batch gaps) on a
   timeline — the same Gantt visual language as the rest of the app.
3. **Utilization:** % of available rig-months actually used, per rig and per year.
4. **Infeasibility diagnostics:** when a yearly target cannot be met under the rules
   at any fleet size (e.g. more wells committed at one project than one rig-year
   can hold and concurrency is capped), the tool says so explicitly and names the
   project/year — it never silently returns a wrong fleet number.

## 7. Solver engines

Two engines behind one interface, selected by environment variable
(`OPTIMIZER_ENGINE=heuristic | milp`, default `heuristic`):

- **Heuristic (default):** deterministic greedy/packing scheduler in owned code,
  plus an analytic lower bound (total required rig-months ÷ available rig-months)
  so the result is provably optimal or within one rig. No new dependencies.
- **MILP (optional):** exact optimization via a solver library (e.g. Google
  OR-Tools, Apache-2.0). **New dependency — flagged for IT review before adoption**
  (ships native binaries). The feature works fully without it.

## 8. Access, audit, and integration

- Page visible and usable by **planners and admins only** (server-enforced via the
  existing `can_plan` gate).
- Read-only with respect to campaign data: runs do not create or modify campaigns,
  revisions, or approvals. (Optional future: "export result as draft campaign".)
- Not part of the governance/approval trail — it is a planning calculator; no
  governance events are emitted for runs.

## 9. Open questions (to settle before build)

1. **Concurrency at a project:** may two rigs work the same project at the same
   time (splitting its wells into parallel chains)? If yes, the batch/gap rules
   apply per rig chain. If no, some yearly targets may be structurally infeasible —
   the tool will flag them (§6.4), but the rule must be decided.
2. **Batch counter across years:** a project's chain can span year boundaries —
   confirm the every-3rd-well counter simply continues (it does not reset on
   1 January).
3. **First well of the horizon:** rigs are assumed available on day one of the
   first year with no mobilization lead time — confirm, or add a per-rig
   mobilization parameter.

## 10. Not decided / future ideas

- Comparing multiple saved scenarios side by side.
- Seeding the tool from existing campaign data instead of upload.
- Rig-count *cost* overlay (rigs × day rate) once commercial data is in scope.
