# Readiness Framework — Feature Specification

**Status:** agreed understanding, pre-implementation · **Date:** 2026-10-13
**Owner:** Osahon Ero · **Requested by:** Wells team, Logistics (Supply Chain expected next)

## 1. Purpose

Readiness today answers one question: *are this field project's sanction gates
done?* — seven fixed gates (FDP, LLI, LOC, FE, FID, EIA, BUD) per field project
(`well_project`), editable by planners, frozen with the plan.

Two new requests break that shape, and more are expected:

1. **Wells team** — readiness checks **per well** (location preparation, permits,
   …), in addition to the project-wide gates.
2. **Logistics** — their own seven checks, including which equipment types are
   nominated for a project or well.
3. **Supply Chain** — expected to ask for its own checks soon.

Rather than a bespoke "Well view" and "Logistics view", readiness becomes **one
generic framework**: an admin-curated catalog of checks, each owned by a team and
attached to a scope. A team's view is a *lens* on one Readiness page. **Adding a
team or a check is configuration, not code.**

## 2. Scope

**In scope**
- Admin-managed check catalog (teams, checks, equipment tag list).
- Two scopes: **field project** (today) and **well**.
- Team edit grants (global), admin-curated and audited.
- Per-check lock behaviour (governed vs operational).
- Lenses on the Readiness page, chart, dashboard and print-out.

**Out of scope for v1 (explicitly agreed)**
- Terrain defaults (auto N/A for Naval Clearance on LAND, terrain-sorted equipment
  dropdown) — skipped 2026-10-13; can be added later without a migration.
- Per-equipment status matrix (Contract/FFP/PO/Naval per vessel) — **flat checks**
  agreed instead.
- Named equipment units ("MV Alpha – PSV") and contract/FFP expiry dates that would
  derive statuses automatically (a registry extension, like rig contracts).
- "Due N days before spud" deadlines that auto-flag Behind.
- CSV/Excel import of well or logistics readiness (managed in the app only, like
  project gates today).
- The well-gate list itself — **left blank for now**; admins add it via the
  catalog when the Wells team supplies it (§11).

## 3. Concepts

Every check is described along four axes:

| Axis | Meaning | Values |
|---|---|---|
| **Check** | What is tracked | Catalog row: code, label, icon |
| **Scope** | What it attaches to | `project` (field project) · `well` · or both |
| **Team** | Who owns and edits it | Projects · Wells · Logistics · (Supply Chain) |
| **Status set** | Which statuses it uses | `standard` · `availability` |

A check may also carry a **tag list** (multi-select from a controlled list) — the
first use is Nominated Equipment.

### 3.1 Two levels

| Level | Attaches to | Identity key | Example |
|---|---|---|---|
| **Project** | A field project, shared by all its wells | campaign + `well_project` | FID, EIA, BUD |
| **Well** | One well activity | campaign + `well_project` + `well_name` + `activity_type` | Location prep, permits, PO |

A well is unique by its project and activity (user-confirmed). The key uses the
**names on the activity, not `Activity.id`**: CSV import defaults to
`replace=True`, which deletes and recreates every activity with new ids. Name keys
survive a re-import — the same reason `project_readiness` is keyed by name today
(`activities.py`, the replace branch).

### 3.2 Teams and lock behaviour

| Team | Checks | Editors | Lock behaviour |
|---|---|---|---|
| **Projects** | The 7 project gates (existing) | Campaign **planners** (unchanged) | **Governed** — frozen with the plan, as today |
| **Wells** | Well gates (TBD) | **Wells** team grant | **Operational** — stays live |
| **Logistics** | 7 logistics checks (§3.4) | **Logistics** team grant | **Operational** — stays live |
| **Supply Chain** | Future | Supply Chain grant | Decided when defined |

- **Governed:** part of what approvers sign; writes are refused with **423** while
  the plan is locked (pending or approved), via `assert_project_not_locked`.
- **Operational:** editable at any time, including after approval. The snapshot
  still records values **as at submission** for reference (§6), but they never lock.

### 3.3 Status sets and the shared severity scale

Status sets are a **small code-defined allow-list** (not admin-editable): a new set
is a reviewed code change, like a new scope. Every status maps to a shared
severity, so rollups (dashboard %, worst-status dot, summary lens) stay generic.

| Severity | `standard` | `availability` | Colour |
|---|---|---|---|
| `done` | Completed | Available | green |
| `in_progress` | On Track | — | amber |
| `blocked` | Behind | Not available | red |
| `not_counted` | N/A | — | muted, struck through |

Default for an unset entry: `standard` → **On Track** (as today);
`availability` → **Not available**.

### 3.4 Logistics checks (seed)

All flat (one status per entry). Codes are **immutable once seeded** — confirm the
proposed ones before Phase 4 ships.

**Every logistics check applies at both project and well level** (decided
2026-10-13) — see the inheritance rule in §3.6.

| Code | Label | Scope | Status set | Tags | Code status |
|---|---|---|---|---|---|
| `L-BUD` | Budget Availability | project + well | standard | — | **decided** (distinct from project `BUD`) |
| `CTR` | Contract Availability | project + well | standard | — | proposed |
| `NEQ` | Nominated Equipment | project + well | **availability** | equipment | proposed |
| `FFP` | Assurance / FFP Inspection | project + well | standard | — | proposed |
| `CTS` | CTS – Community Trust and Support | project + well | standard | — | proposed |
| `PO` | PO | project + well | standard | — | proposed |
| `NAV` | Naval Clearance | project + well | standard | — | proposed |

### 3.5 Nominated Equipment

- A multi-select of **equipment types** from an admin-managed list; types only, no
  named units.
- Assignable to a **project** or a **well**. Equipment on a project is **inherited**
  by each of its wells — shown read-only, labelled "from project". A well's
  effective equipment = project tags ∪ its own tags.
- Its status is **Available / Not available**, set per entry (not derived from the
  tags), and inherits like every other logistics status (§3.6).

Seed list (21 types; code immutable, label and category editable):

| Category | Codes |
|---|---|
| Aviation | RW – Rotary Wing Aircraft/Helicopter |
| Vessels | DSV – Diving Support Vessel · SEV – Security Escort Vessel · AHTS – Anchor Handling Tug · FSIV – Fast Support Intervention Vessel · PSV – Platform Support Vessel · LHT – Line Handling Tug · TB – Tugboat · PC – Personnel Carrier (a boat) |
| Barges | JUB – Jack-up Barge · ENV – Environmental Barge · HB – Houseboat · CBG – Crane Barge · RP – Ramp Barge |
| Land transport | LBT – Lowbed Truck · FBT – Flatbed Truck · CB – Coaster Bus · ACB – Armoured Coaster Bus · MB – Minibus |
| Lifting | CR – Crane |
| Permits | NNRA – Radioactive Source Permit |

### 3.6 Project → well inheritance (checks that apply at both levels)

**Proposed — confirm (§12.4).** One rule for every check enabled at both levels
(today: all logistics checks):

| What | Effective value on a well |
|---|---|
| **Status** | The well's own entry if set; otherwise the **project's** entry, shown greyed "from project". Setting a well status is an **override**; "Reset to project" removes it. |
| **Tags** (NEQ) | Project tags ∪ the well's own tags (project tags read-only on the well). |
| **Neither set** | The status set's default (§3.3). |

So logistics can set PO once for a whole field project and override only the one
well that differs. Rollups, KPIs, chart dots and prints all use the **effective**
value; the grid marks inherited values so nobody mistakes them for a well-specific
entry.

## 4. Data model

New migrations start at **034**. All tables follow the existing conventions: UUID
PKs, `""` (never NULL) as the "not applicable" sentinel inside unique keys (NULLs
are mutually distinct in UNIQUE constraints on every backend we target — see
`resource_registry.py`), and model/migration parity (`test_migration_model_parity`).

### 4.1 Catalog (global — not per campaign)

**`readiness_teams`**
| Column | Type | Notes |
|---|---|---|
| `code` | String(32), unique | `projects`, `wells`, `logistics` — immutable |
| `name` | String(64) | Display name |
| `editor_source` | String(16) | `planner` (campaign planner role) or `team_grant` |
| `icon_key` | String(32) | Team badge in the **All** view (§8.3); code allow-list |
| `sort_order` | int | Lens order |
| `is_active` | bool | |

**`readiness_checks`**
| Column | Type | Notes |
|---|---|---|
| `code` | String(16), unique | Immutable; pattern `^[A-Z][A-Z0-9-]{1,7}$`; never reused, even after retirement (reserved: `CON`) |
| `label` | String(64) | Editable |
| `team_code` | FK → teams.code | |
| `applies_project` / `applies_well` | bool, bool | At least one true; every logistics check has both (§3.6) |
| `status_set` | String(16) | Code allow-list: `standard`, `availability` |
| `icon_key` | String(32) | Code allow-list (§8.5) |
| `locks_with_plan` | bool | Governed (true) / operational (false) |
| `tag_list` | String(32), `""` = none | e.g. `equipment` |
| `sort_order` | int | |
| `retired_at` | DateTime, nullable | Retire, never delete |

**`readiness_tag_items`**
| Column | Type | Notes |
|---|---|---|
| `tag_list` | String(32) | `equipment` |
| `code` | String(16) | Immutable; unique per `(tag_list, code)` |
| `label` | String(64) | |
| `category` | String(64) | Display grouping only |
| `sort_order` / `retired_at` | | As above |

### 4.2 Values (per campaign)

**`readiness_entries`** — replaces `project_readiness` (data-migrated in Phase 1)
| Column | Type | Notes |
|---|---|---|
| `project_id` | FK → projects (CASCADE) | The campaign |
| `check_code` | FK → readiness_checks.code | |
| `scope` | String(8) | `project` / `well` |
| `well_project` | String(256) | Always set |
| `well_name` | String(256) | `""` for project scope |
| `activity_type` | String(256) | `""` for project scope |
| `status` | String(32) | Validated against the check's status set |
| `notes` | String(512), nullable | |
| `updated_at` / `updated_by` | | As today |

Unique: `(project_id, check_code, scope, well_project, well_name, activity_type)`.
**SQL Server index key limit (1700 bytes)** — the key is ≈1.6 KB with three
String(256) columns; verify against the real collation in the migration and fall
back to a hashed key column if it exceeds the limit.

**`readiness_entry_tags`** — `entry_id` FK (CASCADE) + `item_code`; unique
`(entry_id, item_code)`.

### 4.3 Team grants

**`user_team_grants`** — `user_id` FK, `team_code` FK, `granted_by`, `granted_at`;
unique `(user_id, team_code)`. Generic rows, **not** one boolean per team on
`User`, so Supply Chain needs no schema change. Grants are **global**: they cover
every campaign (decided 2026-10-13 — one logistics focal point; per-campaign adding
causes entry fatigue and "nobody can edit" gaps on new or cloned campaigns).

## 5. API and access control

Reads stay **org-wide** (any authenticated user), per the governance model.
Writes default to deny.

### 5.1 Endpoints

| Method | Path | Who |
|---|---|---|
| GET | `/api/readiness/catalog` | Any user — teams, active checks, status sets (with severity), tag lists |
| GET | `/api/projects/{id}/readiness?lens={team\|all}` | Any user — project rows and/or well rows for that lens, with effective (inherited) values marked; `lens` allow-listed against active teams + `all` |
| PUT | `/api/projects/{id}/readiness/{check_code}` | Check's editors (§5.2) |
| POST/PATCH | `/api/admin/readiness/checks[/{code}]` | Admin |
| POST | `/api/admin/readiness/checks/{code}/retire` | Admin |
| POST/PATCH | `/api/admin/readiness/tags[/{list}/{code}]` (+ retire) | Admin |
| PUT | `/api/admin/users/{id}/teams` | Admin |

The PUT keeps the **DS-001 rule**: no user text in the URL path — names travel in
the body. Body (`ReadinessEntryUpsert`, Pydantic v2):

```json
{ "scope": "well", "well_project": "Egbema Node FOD + IOGD",
  "well_name": "EGB-12", "activity_type": "Oil Development",
  "status": "Not available", "notes": null, "tags": ["PSV", "AHTS"] }
```

Validation:
- `scope` ∈ {project, well} and must be enabled on the check.
- Name fields 1–256 chars; `well_name` / `activity_type` required iff `scope=well`,
  forbidden otherwise.
- `status` ∈ the check's status set; `notes` ≤ 512.
- `tags` only when the check has a tag list; each code must be an **active** item
  of that list; deduplicated; ≤ 50; `null` = leave unchanged, `[]` = clear.
- `check_code` must be an active catalog check (retired → 422).
- **BOLA:** the target must exist in *this* campaign — a project scope needs ≥1
  activity with that `well_project`; a well scope needs ≥1 activity matching all
  three names. Otherwise 404 with a generic message.

### 5.2 Authorization — new helper in `app/core/rbac.py`

`assert_can_edit_check(project_id, check, user, db)`, called first in the PUT:

1. Global admin → allow (existing bypass, preserved).
2. `team.editor_source == "planner"` → `assert_member(project_id, user, db,
   allowed_roles={ProjectRole.planner})` — **unchanged behaviour** for project gates.
3. `team.editor_source == "team_grant"` → the user holds a `user_team_grants` row
   for the check's team; otherwise **403** `"Insufficient role for this action"`.

A team grant writes **only that team's checks**: no schedule edits, no project
gates, no submit/sign/approve. Then, only if `check.locks_with_plan`:
`assert_project_not_locked` → 423.

Catalog and grant endpoints require `is_admin`.

### 5.3 Audit

- **Catalog changes** (check/tag create, edit, retire) and **team grant/revoke** —
  `governance_event`, `project_id NULL`, new `ENTITY_READINESS_CATALOG`; grants use
  `ENTITY_USER` with `team_grant_granted` / `team_grant_revoked`, mirroring
  `can_plan_granted`.
- **Entry changes** — today `updated_by` keeps only the **last** editor. With
  global grants spanning every campaign, each entry change also writes an audit
  event (`readiness_updated`, old → new status and tags, `project_id` set), so the
  full history is visible in the campaign audit feed. Append-only, as always.
- Logs carry ids only (no names or emails), per the logging rules.

## 6. Snapshot, diff and history

The snapshot stays a **flat activity list**, so existing readers keep parsing.

| Snapshot key (per activity) | Content | Change |
|---|---|---|
| `readiness` | Governed project gates `{code: status}` | **Unchanged shape**; now built from catalog checks with `locks_with_plan` |
| `readiness_at_submission` | Operational checks, **effective** values `{code: {status, source: well\|project\|default, tags, inherited_tags}}` | **New**; absent in older revisions |

- **Catalog as of submission:** new nullable `revisions.catalog_json` stores the
  definitions (labels, team, status set, icon) used by that snapshot. Older
  revisions have `NULL` → readers fall back to the built-in definitions of the
  original 7 gates. Renaming or retiring a check never changes how a past
  revision renders.
- **Diff:** compares governed `readiness` only (as today). Operational values are
  shown, not diffed — they change daily and would bury real plan changes.
- **`_readiness_pct`** (diff KPI) keeps reading `readiness` → unchanged.
- **Clone:** copies all entries and tags along with the activities, as
  `projects.py` copies gates today.
- **CSV replace:** entries survive a replace (keyed by names), as gates do today.

## 7. Edge cases and rules

1. **Renames carry checks over.** When an activity edit changes `well_project`,
   `well_name` or `activity_type`, and no other activity still carries the old
   key, its entries are re-keyed to the new one. If the new key already has
   entries, those win and the old ones stay orphaned (logged as a warning — no
   silent merge). This also fixes today's orphaning of project gates when every
   activity in a field project is renamed.
2. **Duplicate key:** two activities with the same project + well + activity type
   in one campaign (e.g. two workovers) share well entries. Import and the
   activity form show a **warning** (not a block).
3. **No well name** (Rig Idle, Contracting): no well gates — mirrors "no project →
   no project gates".
4. **Readiness opt-out:** `readiness_required = false` hides **all** teams' dots
   for that activity and drops it from every team's KPI (open question §12.3).
5. **Retired checks:** hidden from the grid and the pickers; stored entries kept;
   still rendered in past revisions via `catalog_json`.
6. **Retired equipment types:** stay on entries that already have them (shown
   struck through); cannot be newly added.
7. **Locked campaign:** governed dots are disabled (as today); operational dots stay
   editable — the lock banner must say **"project gates frozen"**, not "readiness
   frozen".
8. **Overrides:** a well override survives later changes to the project value
   (that is its purpose); the grid flags overridden cells so a stale override is
   visible, and "Reset to project" is one click. Changing a project value never
   rewrites well overrides.

## 8. Frontend

### 8.1 Lenses — one filter everywhere

The lens keeps each view uncluttered: **Project gates · Wells · Logistics · All**.
The same lens selector appears on the Readiness page, the chart and both prints;
the choice is remembered per user (`ds.readiness-lens`) and carried in `?lens=`.

- **Default lens = the user's own team:** Logistics grantee → Logistics; Wells
  grantee → Wells; planners and everyone else → Project gates (several grants →
  first by team order). This is a **convenience, not a restriction** — reads are
  org-wide, so anyone can switch to any lens.
- New teams (Supply Chain) appear as a new lens automatically, from the catalog.

### 8.2 Readiness page

- **Project gates** — today's grid, unchanged.
- **Wells** — one row per well activity (project · well · activity type · start),
  one column per well check.
- **Logistics** — grouped by field project: a **project row** (the project-level
  entries) followed by its **well rows**; well cells show inherited values greyed
  "from project" until overridden (§3.6).
- **All** — well rows with **column groups per team** (Project gates — read-only,
  from the field project · Wells · Logistics). Each group header collapses to a
  single "worst status" column; by default only the user's own team is expanded,
  so the full picture is one click away without a 21-column wall.
- A lens whose team has no active checks shows an empty state ("No well gates
  defined yet — an admin can add them on the Admin page").
- `NEQ` cell opens a picker: grouped multi-select (by category) + Available /
  Not available; inherited project tags shown greyed "from project".
- Dots are editable only where the user can write (§5.2) — the API stays the
  authority.

### 8.3 Chart and dashboard — keeping "All" clean

- **Single-team lens:** that team's icons only, using the chart's existing width
  tiers (full strip → half → grid → single worst icon). `chart-layout.ts` sizes the
  tiers from the lens's check count instead of a fixed 7.
- **All:** one **team badge** per team per bar (3 today, 4 with Supply Chain) —
  the team's icon, coloured by that team's **worst effective severity** (§3.3).
  Narrow bars collapse to a single badge (worst overall). Hovering lists every
  check grouped by team; clicking a badge switches the chart to that team's lens.
  The legend shows the team badges plus the severity colours.
- **Rejected:** stacking every team's strip on each bar (21+ icons) — unreadable,
  and it would inflate the row height of the whole Gantt.
- **Dashboard:** one readiness tile per team over the same focus window; the
  Breakdown "by gate" card gains a team selector.

### 8.4 Printing with a lens

Both prints get a **"Readiness icons"** option: **Project gates · Wells · Logistics
· All · None**.

- **Sequence print** (`SequencePrintControl`, the live plan): defaults to the
  user's lens (§8.1), so a **planner prints with project-gate icons only**, the
  **Logistics team with logistics icons**, the **Wells team with well icons**. The
  choice is remembered, like `ds.print-years`.
- **Every print says which lens it shows:** the header reads e.g. "Readiness:
  Logistics — live status, printed 13 Oct 2026", and the legend lists only that
  lens's icons, so a sheet can't be mistaken for the full readiness picture.
- **Rows don't change with the lens:** the print is still the whole plan (the
  existing rule that two people's prints of "the sequence" must not differ
  silently) — only the labelled icon layer differs.
- **Revision print** (the formal record): defaults to **Project gates** — what the
  approvers signed. Wells / Logistics / All read `readiness_at_submission`, and the
  header says **"status at submission"**. This replaces the separate appendix
  section proposed in the first draft.
- **All** prints the team badges (§8.3); **None** prints a plain sequence.

### 8.5 Icons and output encoding (security)

- Icons come from an **owned icon registry** (`icon_key` → React component + SVG
  path data for the ECharts/print renderer, as `check-icon-svg.ts` does today).
  Admins **choose** a key; they **cannot upload** SVG. The backend allow-list of
  icon keys and the frontend registry are kept identical by a test.
- Admin-entered **labels, categories and notes** now reach the HTML/PDF export —
  directive 2's injection surface. Every such string is contextually encoded in the
  export; React JSX escaping covers the app. No `dangerouslySetInnerHTML`.

### 8.6 Files to move off hard-coded codes (Phase 1)

`api/readiness.ts`, `components/readiness/{check-meta.ts, ReadinessDot.tsx,
ReadinessGrid.tsx}`, `components/chart/{DrillChart.tsx, ChartLegend.tsx,
ActivityChartEditDialog.tsx}`, `components/data-grid/ActivityGrid.tsx`,
`components/revisions/RevisionPrintDoc.tsx`, `lib/{check-icon-svg.ts,
chart-layout.ts, chart-utils.ts}`, `pages/{Presentation.tsx, ProjectDetail.tsx,
RevisionDetail.tsx}`, `dev/fixtures.ts`. `CheckCode` becomes `string`, validated
against the fetched catalog; `CHECK_META` becomes catalog + icon registry.

## 9. Build phases

Each phase ships on its own to `main`, with tests, keeping the suite green.

| Phase | Delivers | Visible change |
|---|---|---|
| **1. Catalog refactor** | Catalog tables seeded with the 7 gates (same codes, labels, icons); `project_readiness` → `readiness_entries` data migration; backend and the §8.6 files read the catalog; `revisions.catalog_json`. | **None.** Riskiest step, so it ships alone. Tests: snapshot JSON identical before/after; pre-change revisions render; diff unchanged. |
| **2. Teams and grants** | `readiness_teams`, `user_team_grants`, `assert_can_edit_check`, Admin page team grants + catalog management, audit events (§5.3), entry-change audit. | Admin page only. |
| **3. Well scope + lenses** | Well-keyed entries, Wells lens (empty until gates are added), lens selector on page/chart/prints with per-user default (§8.1, §8.4), rename carry-over (§7.1), duplicate-key warning, operational lock behaviour. | Wells lens (empty state); planners can already print "project gates only". |
| **4. Logistics + All** | Seed the logistics checks (project + well) + `availability` status set + 21 equipment types; project → well inheritance and overrides (§3.6); `NEQ` tags; `readiness_at_submission`; All view (grid groups, chart team badges, print); dashboard team tiles. | Logistics live; All view. |
| **Supply Chain** | Admin adds a team, checks and grants. | **Configuration only.** |

Per `CLAUDE.md`, each backend phase adds denial tests for the new paths: non-grantee
→ 403; Wells grantee writing a logistics check → 403; planner writing a logistics
check → 403; admin bypass → 200; governed check while locked → 423; operational
check while locked → 200; retired check → 422; inactive tag → 422; unknown well in
campaign → 404; user text never in the URL path.

## 10. `CLAUDE.md` rules that change

Updated **in the same commit as the code that changes them**, not before:

- **Domain integrity** (Phase 1): readiness codes move from a hard-coded enum to an
  **admin-curated catalog** — still an allow-list validated server-side, never
  free-form; codes immutable and never reused; retire, never delete; catalog
  changes audited. Status sets and icon keys remain code-defined allow-lists.
- **Plan-lock lifecycle** (Phase 3): "readiness PUT refused with 423" becomes
  "**governed** readiness checks (`locks_with_plan`) refused with 423; operational
  checks stay editable".
- **Roles** (Phase 2): add global **team grants** — write access to one team's
  readiness checks only; admin-curated, audited, never auto-granted.
- **Governance is auditable** (Phase 2): add team grant/revoke and catalog changes
  to the audited actions.

## 11. Resolved decisions (2026-10-13)

1. One generic framework with team lenses — not a separate view per team.
2. Two levels: project gates + well gates; a well = project + well + activity type.
3. Logistics checks are **flat** (one status each), not a per-equipment matrix.
4. Nominated Equipment = multi-select of equipment **types**, assignable to a
   project or a well; project equipment is **inherited** by its wells (read-only).
5. Nominated Equipment status = **Available / Not available**.
6. **No terrain defaults** in v1.
7. **PC** (Personnel Carrier) is a boat → Vessels.
8. Logistics Budget Availability is **distinct** from project BUD → code **`L-BUD`**.
9. Team grants are **global** (all campaigns); the Wells team owns well gates and
   Logistics owns logistics checks; planners are unchanged and stay per campaign.
   Name a **backup grantee** per team (one focal point = single point of failure).
10. **Project gates lock** with the plan; **well gates and logistics stay live**.
11. **Every logistics check applies at project level as well as well level.**
12. **Lenses** (Project gates · Wells · Logistics) keep views uncluttered; an
    **All** view shows everything cleanly (team badges on the chart, collapsible
    team column groups in the grid).
13. **Printing by lens:** the Wells and Logistics teams can print the sequence with
    their own icons; planners can print with project-gate icons only.

## 12. Open questions

1. **Well-gate list** — names and status set for each (location preparation,
   permits, …). Left blank; added via the catalog, no code change needed.
2. **Logistics codes** — confirm `CTR, NEQ, FFP, CTS, PO, NAV` before Phase 4 (codes
   are immutable once seeded).
3. **Readiness opt-out** — should `readiness_required = false` hide well and
   logistics checks too (proposed), or only project gates?
4. **Inheritance rule (§3.6)** — a project-level logistics status applies to all
   its wells until a well overrides it (proposed). Confirm, or keep project and
   well entries independent.
5. **Who can see the Logistics lens** — org-wide read is assumed (as all readiness
   today); confirm nothing in logistics data is restricted.

## 13. Future ideas (not decided)

- Terrain defaults (auto N/A, terrain-sorted equipment list).
- Named equipment units in the resource registry, with contract and FFP-inspection
  expiry dates driving `CTR` / `FFP` automatically — like "contracts at risk".
- Need-by offsets ("PO due 30 days before spud") that auto-flag `blocked`.
- Notifications to a team when its checks turn `blocked` inside the focus window.
