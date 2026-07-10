# Rig Registry & Physical-Unit Identity — Design Spec (Phase 2)

**Status:** Agreed — decisions resolved 10 Jul 2026 (see §10): HWUs are MOBILE
across terrains (identity = name, unlike rigs); rename-on-award is planner-gated;
the placeholder 2035-01-01 contracts on the seven cross-terrain slots are dropped
in migration (procurement watchlist takes over).
**Date:** July 2026
**Prereqs shipped (Phase 1.5):** rig identity `(kind, terrain, name)` in conflict
detection (backend + frontend), per-lane dashboard rig stats, soft import warning
when a name spans terrains, terrain-aware data tooling.

---

## 1. Motivation

The July 2026 campaign audit showed the fleet's identity model living entirely in
naming conventions inside the planner's head:

- 7 class-style names (`10K Rig 1–5`, `Jack up Rig`, `Jack Hardy`) each covered
  **two physical rigs** (one per terrain). Name-only identity manufactured 74
  false conflicts around 19 real ones.
- Real, named units (`T209`, `HL19`, `BR301`, …) each live in exactly one
  terrain — confirming rigs are terrain-locked physical assets.
- Class-style names are **placeholder slots**: rigs the planner needs but has
  not procured. Their "contract dates" (2035-01-01 on all seven) are
  placeholders too.
- Contracts are stored one-per-name, so a name covering two rigs carries one
  contract date that can only be right for one of them.

Phase 2 turns the convention into structure: a registry that says what a
physical rig **is**, so identity, contracts, procurement status and renames stop
depending on discipline.

## 2. Concepts

| Term | Meaning |
|---|---|
| **Physical unit** | One rig or HWU. **Rig** identity = `(rig, terrain, name)` — rig classes are terrain-locked by construction (land rig ≠ swamp barge ≠ jack-up). **HWU** identity = `(hwu, name)` — HWUs are modular and move across terrains (decision Q1), so the same name in two terrains is ONE unit and can still double-book itself across them. |
| **Lane** | The unit's timeline on the chart — already labelled `TERRAIN – Name`. |
| **Capability class** | What the unit can do (e.g. `10K`, `15K`, hookload/pressure rating). An attribute, never identity. |
| **Placeholder slot** | A planned unit known only by class — e.g. `10K Rig 3` (SWAMP). Scheduled like a real unit; procurement supplies the real name later. |
| **Rename-on-award** | The audited operation that matures a slot's name into the contracted unit's name, carrying activities + contract + history. |

## 3. Data model

New table **`resource_registry`** (one row per physical unit per campaign):

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `project_id` | FK → projects | Registry is per campaign (same physical rig may appear in successive campaigns) |
| `kind` | `rig \| hwu` | |
| `terrain` | `LAND \| SWAMP \| OFFSHORE \| null` | Part of identity for rigs; **null for HWUs** (mobile — decision Q1) |
| `name` | str (trimmed) | Unique per `(project, kind, terrain)` **case-insensitively**; for HWUs effectively per `(project, kind)` |
| `capability_class` | str \| null | Free-text short label (`10K`, `15K`, `HWU-340`); bounded length |
| `is_placeholder` | bool | True = unprocured slot; cleared by rename-on-award (or manually) |
| `created_at / updated_at / updated_by` | | Standard bookkeeping |

**Contracts**: `rig_contracts` gains a `terrain` column (nullable for legacy
rows); uniqueness becomes `(project, rig_name, terrain)`. `hwu_contracts` is
**unchanged** — HWU identity is name-only, so one contract per HWU name stays
correct. Contracts stay their own tables (workflow state machine is already
built). The contract upsert accepts an optional `terrain`: omitted, it resolves
from the registry when the name is unambiguous and 409s when it isn't — so the
existing UI keeps working for every single-terrain rig. A **placeholder unit is
expected to have no contract** — that absence is signal, not error (§4.6).

Activities keep storing `rig_name`/`hwu_name` + `location` (no FK): snapshots
must stay self-contained and historical revisions must render without registry
lookups. The registry is the authority for identity *going forward*; activities
reference it by the identity triple.

## 4. Behaviors

### 4.1 Auto-registration (zero planner friction)
Creating/importing an activity with rig `X` in terrain `T` ensures a registry
row `(rig, T, X)` exists — created with `is_placeholder=true`, class null.
The planner's existing workflow (type name + location, exactly as in Excel)
registers units as a side effect. No new data-entry technique.

### 4.2 Normalized identity
Names are trimmed and matched case-insensitively (`10k rig 3` ≡ `10K Rig 3`;
first-seen casing is kept for display). This absorbs the spelling-variant class
of data decay found in the audit.

### 4.3 Cross-terrain names
Legal (two units) — the shipped soft warning stays: *"'X' appears in multiple
terrains — treated as N units; if it is one unit, a location is a typo."*
The registry list makes the situation visible at a glance.

### 4.4 Rename-on-award
`POST /api/projects/{pid}/resources/{resource_id}/rename {new_name}`:
- Planner-gated (see §10-Q2); refused with 423 while the plan is locked
  (renames change snapshot-relevant data).
- Refused with 409 if `new_name` already exists in the same `(kind, terrain)`.
- Atomically updates: registry row, all matching activities' `rig_name`
  (scoped to the terrain), and the contract row's name.
- Clears `is_placeholder`.
- Emits governance audit `resource_renamed {kind, terrain, from, to, activities_updated}`.
- Approved snapshots are **not** rewritten — the immutable record keeps the name
  that was approved; the rename appears in the next revision's diff.

### 4.5 Registry edits
Class/placeholder edits: planner-gated, plain audit log entries. Deleting a
registry row is allowed only when no activities reference the identity triple.

### 4.6 Procurement early warning
Dashboard/watchlist addition: **placeholder units with activities starting
within the next N months** (default 9 — procurement lead time) and/or any
non-placeholder unit without a contract. Complements the contract-expiry
gradient: expiry warns about contracts ending; this warns about contracts that
don't exist yet.

### 4.7 Chart & print
Placeholder lanes get a subtle "TBD" affordance on the interactive chart
(e.g. suffix chip on the lane label / tooltip note). The formal print stays
unbadged — slot names are already self-describing, and the print records the
approved plan as-is.

## 5. API surface (new/changed)

| Endpoint | Change |
|---|---|
| `GET /api/projects/{pid}/resources` | List registry (kind, terrain, name, class, placeholder, contract summary) |
| `PATCH /api/projects/{pid}/resources/{id}` | Edit class / placeholder flag |
| `POST /api/projects/{pid}/resources/{id}/rename` | Rename-on-award (§4.4) |
| `PUT /api/projects/{pid}/contracts/{rig_name}` | Gains required `terrain` (query/body); upsert keyed by triple |
| Import | Auto-registers units; contract upserts carry the row's terrain |

All endpoints: `assert_member(..., allowed_roles={planner})` for writes, standard
org-wide read; deny by default; generic error messages.

## 6. RBAC & audit

- Writes are planner-only (admin bypass preserved as everywhere).
- `resource_renamed` is a governance event (append-only audit), because it
  changes the identity that approvals and JV documents refer to.
- Registry create (auto or manual) logs a plain audit entry; no governance
  event (high volume, low governance weight).

## 7. Migration & backfill (Alembic)

1. Create `resource_registry`; add `terrain` to both contract tables.
2. Backfill registry from existing activities: distinct
   `(project, kind, location, name)` → one row each, `is_placeholder=true`
   (planner flips real units off afterwards — or we default names matching a
   curated "known units" list to false; simplest is all-true + one review pass).
3. Backfill contract `terrain`: unambiguous names (one terrain) inherit it;
   ambiguous names — see §10-Q3.
4. `test_migration_model_parity` keeps schema and models honest.

## 8. Test plan

- Unit: normalized uniqueness, cross-terrain legality, rename scoping (only the
  named terrain's activities move), placeholder lifecycle.
- AuthZ negatives: viewer/reviewer rename → 403; non-member → 403/404.
- Lock: rename while pending revision → 423.
- Governance: rename emits `resource_renamed`; audit is append-only.
- Migration: backfill on a fixture DB with the seven ambiguous names.
- Import: auto-registration; contract upsert lands on the right terrain.

## 9. Out of scope (Phase 3+)

- Requirement↔capability validation (HPHT well on a 10K slot = hard error) —
  needs well requirements data; the `capability_class` column is the foundation.
- Cross-campaign global rig directory.
- Admin activity-type catalogue (separate feature, previously specced).

## 10. Open decisions

| # | Question | Recommendation |
|---|---|---|
| Q1 | Are HWUs terrain-locked like rigs, or mobile across terrains? | Planner said rigs are strict; HWUs are modular and often cross terrains. Recommend: HWUs registered per terrain like rigs for now (consistent, matches current data), revisit if a real HWU needs two terrains |
| Q2 | Who may rename — planner or admin-only? | **Planner** (it's a planning act; audited + lock-guarded), admin bypass as usual |
| Q3 | Contract backfill for the 7 cross-terrain names (all carrying placeholder 2035-01-01) | Treat as **placeholder slots: drop the placeholder contract rows** during migration; the procurement watchlist (§4.6) takes over. No real contract data is lost — 2035-01-01 was never a contract |
