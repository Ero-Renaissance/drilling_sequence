# Readiness Framework — Feature Specification

**Status:** phases 1–5 shipped · **Date:** 2026-10-13 · §3.7 Rollups agreed
2026-10-16 · **§3.8 Checks that apply agreed 2026-10-23** (phase 6, built — PR #24) ·
**§3.9 Equipment checks agreed 2026-10-24** (phase 7, built — PR pending)

> Passages marked "phase 6" or "since phase 6", and the withdrawal of `NEQ`
> dated 2026-10-23 (decisions 27–34), describe that proposal. Until it ships,
> the phase 1–5 behaviour applies: N/A can still be picked for every check, and
> `NEQ` and its equipment list are live. The Project gates don't change in
> phase 6. Passages marked "phase 7" (decisions 35–41) are built on branch
> feature/readiness-equipment-checks (PR pending) but not yet shipped; until
> phase 7 ships, Logistics has its six core checks and every team check
> starts ticked.

**Owner:** Osahon Ero · **Requested by:** Wells team, Logistics (Supply Chain expected next)

## 1. Purpose

Readiness today answers one question: *are this field project's sanction gates
done?* — seven fixed gates (FDP, LLI, LOC, FE, FID, EIA, BUD) per field project
(`well_project`), editable by planners, frozen with the plan.

Two new requests break that shape, and more are expected:

1. **Wells team** — readiness checks **per well** (location preparation, permits,
   …), in addition to the project-wide gates.
2. **Logistics** — their own seven checks, including which equipment types are
   nominated for a project or well. (The equipment part was withdrawn on
   2026-10-23 — §3.5; Logistics will keep six checks once phase 6 ships; phase 7
   brings the 21 equipment types back as Logistics checks that start unticked,
   §3.9.)
3. **Supply Chain** — expected to ask for its own checks soon.

Rather than a bespoke "Well view" and "Logistics view", readiness becomes **one
generic framework**: an admin-curated catalog of checks, each owned by a team and
attached to a scope. A team's view is a *lens* on one Readiness page. **Adding a
team or a check is configuration, not code.**

## 2. Scope

**In scope**
- Admin-managed check catalog (teams, checks; the equipment tag list was
  withdrawn on 2026-10-23, §3.5).
- Two scopes: **field project** (today) and **well**.
- Team edit grants (global), admin-curated and audited.
- Per-check lock behaviour (governed vs operational).
- Lenses on the Readiness page, chart, dashboard and print-out.
- Per field project / per well choice of **which checks apply**, for every team
  except the Project gates (§3.8, phase 6).

**Out of scope for v1 (explicitly agreed)**
- Terrain defaults (auto N/A for Naval Clearance on LAND, terrain-sorted equipment
  dropdown) — skipped 2026-10-13. Since phase 6 the equivalent idea is catalog
  rules for which checks apply (§13).
- Per-equipment status matrix (Contract/FFP/PO/Naval per vessel) — **flat checks**
  agreed instead.
- Named equipment units ("MV Alpha – PSV") and contract/FFP expiry dates that would
  derive statuses automatically (a registry extension, like rig contracts).
- "Due N days before spud" deadlines that auto-flag Behind.
- CSV/Excel import of well or logistics readiness (managed in the app only, like
  project gates today).
- The well-gate list itself — **left blank for now**; admins add it via the
  catalog when the Wells team supplies it (§12, open question 1).

## 3. Concepts

Every check is described along four axes:

| Axis | Meaning | Values |
|---|---|---|
| **Check** | What is tracked | Catalog row: code, label, icon |
| **Scope** | What it attaches to | `project` (field project) · `well` · or both |
| **Team** | Who owns and edits it | Projects · Wells · Logistics · (Supply Chain) |
| **Status set** | Which statuses it uses | `standard` (`availability` is history only since 2026-10-23, §3.5) |

Each team except the Projects team also chooses, per field project or well,
**which of its checks apply** (§3.8); the Project gates keep N/A. A check could once carry a **tag list** (Nominated Equipment) — withdrawn
on 2026-10-23 (§3.5).

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
| **Logistics** | 6 logistics checks (§3.4; `NEQ` withdrawn 2026-10-23); phase 7 adds 21 equipment checks that start unticked (§3.9) | **Logistics** team grant | **Operational** — stays live |
| **Supply Chain** | Future | Supply Chain grant | Decided when defined |

- **Governed:** part of what approvers sign; writes are refused with **423** while
  the plan is locked (pending or approved), via `assert_project_not_locked`.
- **Operational:** editable at any time, including after approval. The snapshot
  still records values **as at submission** for reference (§6), but they never lock.

### 3.3 Status sets and the shared severity scale

Status sets are a **small code-defined allow-list** (not admin-editable): a new set
is a reviewed code change, like a new scope. Every status maps to a shared
severity, so rollups (dashboard %, worst-status dot, summary lens) stay generic —
§3.7 defines them.

| Severity | `standard` | `availability` (history only, §3.5) | Colour |
|---|---|---|---|
| `done` | Completed | Available | green |
| `in_progress` | On Track | Pending | amber |
| `blocked` | Behind | Not available | red |
| `not_counted` | N/A — picked for a **Project gate** that doesn't apply. For other teams' checks it is **recorded only** since phase 6: a check that doesn't apply (§3.8) | — | Project gates: grey N/A icon. Other teams: not drawn (phase 6) |

**Picked vs recorded (2026-10-23, phase 6).**
- **Project gates** — every check that locks with the plan — keep all four
  statuses, N/A included, exactly as today (decision 31).
- **Every other check:** a person picks only On Track, Completed or Behind.
  "Doesn't apply" is the tick list of §3.8. N/A stays in the `standard` set, so
  N/A values already in history and in snapshots keep their severity, but the
  status PUT refuses it for these checks (422) and their menus and legends don't
  offer it. Snapshots record an unticked team check as N/A (§6) (since phase 7, only a check that doesn't apply because of a row; one that is not selected is blank, unlisted, not counted even as not applicable and left out of snapshots, §3.9).
- **The rule:** a check's pickable statuses are its set's statuses, minus N/A
  when the check doesn't lock with the plan.
- The `availability` set is **history only** (`"history_only": True` in
  `STATUS_SETS`): refused for new checks, kept so revisions that recorded
  Nominated Equipment still render (§3.5).

Both rules are written in code.
- **The `history_only` flag** is mirrored in `check-meta.ts`'s `STATUS_SETS`
  literal (never a second list) and pinned by the parity tests, whose regex
  changes with the literal.
- **The pickable rule** is a function, which no parity test can pin. A backend
  test pins it (N/A → 422 on a team check, 200 on a Project gate), and so does a
  frontend test of the menu helper (team check: no N/A; gate: N/A).

**An unset entry reads its status set's default, and every default is on track**
— that is how planners work: nobody has reported a problem (confirmed
2026-10-16, §3.7). `standard` → **On Track**; `availability` → **Pending** (added
2026-10-16; history only since phase 6). Revisions submitted before the change
keep the value they stored (Not available for unset equipment).

### 3.4 Logistics checks (seed)

All flat (one status per entry). Codes are **immutable once seeded**; all seven
were confirmed on 2026-10-14 (decision 15). `NEQ` was withdrawn on 2026-10-23
(§3.5), so Logistics will have six checks once phase 6 ships.

**Every logistics check is enabled at both project and well level** (decided
2026-10-13) — see the inheritance rule in §3.6.

| Code | Label | Scope | Status set | Tags | Code status |
|---|---|---|---|---|---|
| `L-BUD` | Budget Availability | project + well | standard | — | **decided** (distinct from project `BUD`) |
| `CTR` | Contract Availability | project + well | standard | — | confirmed |
| ~~`NEQ`~~ | ~~Nominated Equipment~~ | project + well | **availability** | equipment | **withdrawn 2026-10-23** (§3.5) |
| `FFP` | Assurance / FFP Inspection | project + well | standard | — | confirmed |
| `CTS` | Community Trust and Support | project + well | standard | — | confirmed |
| `PO` | Purchase Order | project + well | standard | — | confirmed |
| `NAV` | Naval Clearance | project + well | standard | — | confirmed |

**Phase 7 equipment checks** (migration 039, §3.9) — Logistics, project + well,
`standard`, **start unticked**, plain codes from §3.5's seed list:

| Category | Codes | Icon |
|---|---|---|
| Aviation | `RW` | helicopter |
| Vessels | `DSV` `SEV` `AHTS` `FSIV` `PSV` `LHT` `TB` `PC` | anchor |
| Barges | `JUB` `ENV` `HB` `CBG` `RP` | container |
| Land transport | `LBT` `FBT` `CB` `ACB` `MB` | bus |
| Lifting | `CR` | construction |
| Permits | `NNRA` | radiation |

Labels are §3.5's names (e.g. "Platform Support Vessel"). Look-alike codes
(`CR`/`CTR`, `PC`/`PO`, `CB`/`CBG`) always appear next to their labels in the tick
list and the grid headers' titles. Tooltip lines, which list codes, add the label
after a look-alike code: "PC (Personnel Carrier) Behind".

### 3.5 Nominated Equipment — withdrawn 2026-10-23

> **Phase 7 (2026-10-24):** the 21 equipment types return as ordinary Logistics
> *checks*, one per type, which start unticked (§3.9). `NEQ` and its tag list stay
> retired and history-only, as below.

**Withdrawn (decision 30; to be built in phase 6).** Nominated Equipment is no longer a
readiness check, and there is no equipment list: no readiness icon opens a list
of options any more (an icon only opens its status menu). The tick list that
decides which checks apply is a different thing (§3.8) and opens from a row.

- The `NEQ` check is **retired** by migration 038 (§4.4), never deleted. Its code
  stays taken and it is **withdrawn**: it can't be restored or re-created (§5.1).
- The `availability` status set and the `equipment` tag list are **history only**
  — kept so past revisions render as recorded, refused for new checks.
- Stored NEQ statuses, equipment tags and their audit history stay in the
  database. Approved revisions keep NEQ's icon and status from their frozen
  catalog. The equipment names stay in the stored data but are no longer shown
  anywhere (revision prints never showed them).
- Removed: the equipment picker, the Admin page's "Equipment types" section, the
  "RW · DSV" text after the chart icons, the equipment line in tooltips and the
  "NEQ (RW, DSV)" part of the All-lens summary.
- Logistics figures change on deploy: six checks per target, so NEQ's Pending no
  longer counts as on track and its Not available no longer as behind. Project
  gate figures, the last-approved tile and the compare % are unaffected (NEQ was
  never governed).

The original definition (2026-10-13 → 2026-10-23), kept for reference:

- A multi-select of **equipment types** from an admin-managed list; types only, no
  named units.
- Assignable to a **project** or a **well**. Equipment on a project is **inherited**
  by each of its wells — shown read-only, labelled "from project". A well's
  effective equipment = project tags ∪ its own tags.
- Its status is **Available / Pending / Not available** (Pending, the default,
  added 2026-10-16), set per entry (not derived from the tags), and inherits like
  every other logistics status (§3.6).

Seed list (21 types; code immutable, label and category editable):

| Category | Codes |
|---|---|
| Aviation | RW – Rotary Wing Aircraft/Helicopter |
| Vessels | DSV – Diving Support Vessel · SEV – Security Escort Vessel · AHTS – Anchor Handling Tug · FSIV – Fast Support Intervention Vessel · PSV – Platform Support Vessel · LHT – Line Handling Tug · TB – Tugboat · PC – Personnel Carrier (a boat) |
| Barges | JUB – Jack-up Barge · ENV – Environmental Barge · HB – Houseboat · CBG – Crane Barge · RP – Ramp Barge |
| Land transport | LBT – Lowbed Truck · FBT – Flatbed Truck · CB – Coaster Bus · ACB – Armoured Coaster Bus · MB – Minibus |
| Lifting | CR – Crane |
| Permits | NNRA – Radioactive Source Permit |

### 3.6 Project → well inheritance (checks enabled at both levels)

**Decided 2026-10-13.** One rule for every check enabled at both levels
(today: all logistics checks). Whether a check *applies* inherits the same way
but separately from its status — §3.8.

| What | Effective value on a well |
|---|---|
| **Status** | The well's own entry if set; otherwise the **project's** entry, shown greyed "from project". Setting a well status is an **override**; "Reset to project" removes it. Phase 6: the project's entry is inherited only while the check applies to the field project; a well ticked under an unticked field project reads the default (§3.8). |
| **Tags** (NEQ) | Project tags ∪ the well's own tags (project tags read-only on the well). **Withdrawn 2026-10-23** (§3.5); past revisions keep them as recorded. |
| **Neither set** | The status set's default — On Track (§3.3). |

So logistics can set PO once for a whole field project and override only the one
well that differs. Rollups, KPIs, chart dots and prints all use the **effective**
value (§3.7); the grid marks inherited values so nobody mistakes them for a
well-specific entry.

### 3.7 Rollups — one definition of readiness for every view

**Agreed and implemented 2026-10-16 (§9, phase 5).**
Until now each view
rolled readiness up its own way: the Readiness tab's bar, the Overview tile, the
last-approved tile and the revision compare % used four formulas and two meanings
of "ready", so the same seven icons could read 50% on one screen and 75% on
another. Every figure, tile, badge, tooltip and print follows this section.

**Readiness measures what is done.** "On Track" is a forecast: it is reported
beside the headline, never counted as ready.

**Cells.** A *cell* is one check for one *target*: a field project (project-level
checks) or a well — field project + well + activity type (well-level checks). Its
value is the effective status of §3.6: the well's own entry, else the field
project's (only while the check applies there — §3.8), else the status set's
default. A check that **doesn't apply** to the
target (unticked, §3.8) is `not_counted`, whatever status sits underneath —
except a check that is **not selected** (phase 7, §3.9), whose cell is left out
of every figure, not even counted as not applicable. Every
rollup reads the cell's **severity** (§3.3), never the status text:

| Severity | Statuses | Counted | Complete | On track | Behind |
|---|---|---|---|---|---|
| `done` | Completed · Available | yes | yes | yes | — |
| `in_progress` | On Track · Pending | yes | — | yes | — |
| `blocked` | Behind · Not available | yes | — | — | yes |
| `not_counted` | N/A (a Project gate, picked as today) · doesn't apply (a team check, §3.8) · N/A in history | — | — | — | — |

**Unset means on track.** A cell nobody has set reads its default — On Track —
because that is how planners work: no reported problem
is no problem. It counts toward the total as on track, never as done, so an
untouched target reads 0% complete · 100% on track. (A separate "Not set" state
was considered and rejected on 2026-10-16.)

**No Clear action.** Since an unset cell already reads On Track, a status set by
mistake is fixed by picking the right one. A well that overrides its field
project keeps **Reset to project** (§3.6) — the one case where removing a value
changes what the cell shows.

**The three figures** — shown together, in this order, wherever readiness is
summarised:

| Figure | Formula | Shown as |
|---|---|---|
| **Complete** (headline) | done ÷ counted | "50% complete" |
| **On track** | (done + in progress) ÷ counted | "83% on track"; tooltip and legend: "Completed or On Track (nothing behind)" |
| **Behind** | number of blocked cells | "1 behind" |

- With no counted cell, both percentages read **"—"**, never 0%.
- Percentages round half up to a whole number, identically on backend and
  frontend.

**Ready.** A target is *ready* when it has at least one counted cell and every
counted cell is done. A target where nothing counts reads **"Nothing applies"**:
every Project gate set to N/A, every team check unticked (§3.8), or all N/A in
history. It is left out of the ready count, which reads e.g. "4 of 6 ready" over
the targets that have a counted cell. It stays listed in the grids — that is
where a gate can be set back from N/A, or a team check re-ticked — and in a grid
summary's row count.

**Worst status.** Where one icon stands for several cells — a narrow chart bar, an
All-lens team badge, a folded column of the All grid, the marker on a project's
other bars — it takes the highest severity: `blocked` > `in_progress` > `done` >
`not_counted`, ties to catalog order. Colours follow §3.3. The marker on a
project's other bars appears whenever that worst severity is `blocked` (Behind;
also Not available while `NEQ` is live, until phase 6).

- **Project gates where every gate is N/A** keep the grey N/A icon, as today.
- **A team whose checks don't apply** to a target (all unticked) has **no icon**
  there (phase 6). Its unticked cells are dropped before the worst status is
  taken (§5.1), so the worst-status rule itself doesn't change.

**Worked example** — one field project's seven gates:

| Gates | Complete | On track | Behind | Ready | Icon |
|---|---|---|---|---|---|
| 3 Completed, 2 On Track, 1 Behind, 1 N/A | 3/6 = 50% | 5/6 = 83% | 1 | no | red |
| 3 Completed, 1 Behind, 1 N/A, 2 never set | 3/6 = 50% | 5/6 = 83% | 1 | no | red |
| 6 Completed, 1 N/A | 6/6 = 100% | 100% | 0 | yes | green |
| Nothing set (all read On Track) | 0/7 = 0% | 7/7 = 100% | 0 | no | amber |
| All 7 N/A | — | — | 0 | Nothing applies | grey N/A |

For another team's checks, an unticked check (§3.8) counts exactly as N/A does
here; only its icon differs — none, instead of grey (since phase 7, only a check that doesn't apply because of a row; one that is not selected is blank, unlisted, not counted even as not applicable and left out of snapshots, §3.9).

**What counts.**
- **Each target once**, however many activities share it: a field project with
  five wells counts its gates once; two workovers that share a well key count once
  (§7.2).
- **Targets per lens:** every tile of a team with project-level checks counts
  **field projects** — the Project gates always have; a team with checks at both
  levels too since 2026-10-25 (it counted wells before). A team whose checks are
  all well-level counts **wells**: its grid has only the Wells view, so a
  field-project count would match no view. For a check enabled at well level, a
  field project reads the
  **worst of its in-scope wells**: each well's effective value, its project's
  unless the well has its own (§3.6), so the check is done for the field project
  only when it is done for every well that needs it, and behind when any of them
  is behind. A project-only check — or a field project with no well in scope —
  reads the project's own value. A well with no field project is on no tile
  (it is still on the Wells view). The team grid's Projects rows carry these
  figures per window (`figures_by_window`, only the wells with work starting
  within it folding in), so the tab adds up to the tile; a row names its wells
  behind ("1 well behind": wells in the window behind on a check enabled at well
  level, counted by the server, `wells_behind_by_window` — a project-only check
  is the project's own, so a well that only carries it isn't counted).
- **Checks:** active checks of active teams; a revision uses its frozen catalog
  (`catalog_json`). Retired checks never count.
- **No readiness at all**, in live views and snapshots alike:
  - an activity with `readiness_required = false` (§7.4). A field project left
    with no readiness-required activity is not a target: it is hidden from the
    Project gates grid and from every figure;
  - project-level checks on an activity with no field project (§7.3);
  - well-level checks — including checks enabled at both levels — on an
    activity with no well name (§7.3);
  - (phase 7) a check that starts unticked and is **not selected** for the target
    (§3.9): its cell reads `applies = false` from the check's own default. It is
    left out of every figure — not even counted as not applicable — and out of
    snapshots, so it never reaches a "Not applicable" list or the not-counted
    (`na`) count. A target whose only cells are not selected has nothing counted
    and reads "Nothing applies", like any other.
    One helper in `readiness_effective`, `not_selected(value)` (`not
    value.applies and value.applies_source == "default"`), serves three callers:
    `_team_rows`' `figures` (which still returns the cell itself, for the tick
    list), both branches of `live_cells`, and the snapshot's `at_submission`;
  - project-only checks on a well whose activity has no field project. Snapshots
    already skip these; phase 6 makes the live cells and the team grid skip them
    too (today they count at their default and can never be unticked). Every view
    draws an omitted cell like one that doesn't apply: "—" in the grid, no icon on
    the chart or a print. Today `TeamReadinessGrid` (`state?.status ??
    defaultStatusOf(...)`) and `DrillChart` (`checks[code]?.status ?? "On Track"`,
    with `barStripCodes` returning every code outside the All lens) redraw a
    missing cell at its default, so both change.
- **Project gates are the governed checks:** only the Projects team's checks lock
  with the plan; the admin catalog refuses a governed check in any other team.

**Window.** Every figure covers the targets in scope for one window — 6, 12 or 24
months, or **All**. A target is in scope when it has at least one
readiness-required activity that is not completed and starts on or before today +
the window (All: no date limit).
- Grids list only the targets in scope: a field project or well whose activities
  are all completed (or all opted out) drops out of the Readiness tab, whatever
  the window. The per-activity readiness panel still shows any activity's values.
- Overview tiles default to 12 months; the Readiness tab opens on **All**.
- Links carry the window: a tile opens its grid on the same window, so the grid
  shows the number the tile showed. Each row carries its days to focus start
  counted from the SERVER's today, so the browser applies the window on the same
  calendar as the tile (no time-zone drift at midnight).
- A summary above a grid describes exactly the rows shown, after every filter
  including search, and says what it covers: "12 field projects · next 12 months".
  A team grid shows one view at a time (§8.8): its Projects view sums field
  projects, its Wells view sums wells — the Projects view reads as the team's
  Overview tile, which counts field projects, so the tile's links open the
  Projects view. A team whose checks are all well-level has only the Wells view;
  its tile counts wells and opens it.

**"Starting soon, not ready."** Activities starting within 90 days whose
**Project gates** are not ready (an unset gate reads On Track, so it is not
ready). Team readiness is reported by the team tiles, not by this rule. Since
2026-07-17 the Overview no longer shows it as a warning: it survives as the
`near_term_not_ready` API field and the grids' "not ready" focus filter. It reads
the Project gates only, so phase 6 doesn't change it. A field project whose gates
are all N/A still counts as not ready there, as today.

**Snapshots and revisions.**
- New snapshots record no gates for an activity with no field project, and no
  well-level checks (two-level ones included) for one with no well name. Prints
  draw readiness only for rows that carry gates; Compare ignores the defaults
  older snapshots stored for activities with no field project.
- Older revisions are read as stored — an unset equipment check recorded before
  Pending existed reads Not available there.
- The last-approved tile and the revision compare % apply this section to the
  snapshot, with the revision's frozen catalog — each field project once (the
  compare % no longer weights a project by its number of activities). Revisions
  that recorded gates PER ACTIVITY (before 2026-07-16) keep that aggregation:
  each activity is its own target. No format marker was stored, so they are told
  apart by shape — a per-field-project snapshot repeats one copy of a project's
  gates on all its activities and only defaults where there is no field project.

**One implementation.** A single backend rollup service computes cells,
severities and the three figures. It feeds the Overview tiles (the Project gates
tile is simply the Projects team's tile), the last-approved tile and the revision
compare %, and returns each Readiness-tab row's own `figures` (counted, done, on
track, behind, ready). A grid's summary adds up the `figures` of exactly the rows
it shows and divides, with the same half-up rounding — it never decides which
cells count. Tests pin that the tab, summed for a window, reads exactly what the
tile reads for it. Per-activity tooltip summaries use one helper
(`lib/team-summary.ts`).

### 3.8 Checks that apply

**Agreed 2026-10-23 (§9, phase 6) — built, PR #24 open.** Decisions 27–34 (§11).

**Who gets it.** The tick list is for every team **except the Projects team**:
Wells, Logistics and future teams such as Supply Chain. Those are the teams whose
checks stay editable after approval. **The Project gates stay exactly as they
are** (decision 31):
- a gate that doesn't apply is marked **N/A** in its status menu;
- it is drawn as the grey N/A icon;
- it is frozen with the plan;
- it is recorded in revisions as N/A.

In code, the split is the check's `locks_with_plan` flag. A check that locks with
the plan keeps N/A and has no tick list; every other check uses the tick list. By
decision 23 only the Project gates lock with the plan, so the split is exactly the
Project gates versus every other team's checks.
- The admin catalog has required this of the Projects team's checks since phase
  2, and refused it in other teams since phase 5 (decision 23, 2026-10-16) — at
  creation only.
- So a governed check an admin created in another team between 2026-10-13 and
  2026-10-16 would also keep N/A, get no tick, and be left out of the Checks…
  picker.
- Migration 038 logs any such check. None is expected; the dev catalog has none.

**Words.** For a team check, a check **applies** (ticked) or **doesn't apply**
(unticked) to a target; a Project gate that doesn't apply is set to N/A instead
(decision 31). Where a check *can* be set — field project, well or both — is the level
it is **enabled at** (`applies_project` / `applies_well` in the catalog, §4.1).
The two are never mixed.

Each of those teams decides, for each field project and well, **which of its
checks apply**. It is a tick list, like the old equipment picker: every check
starts **ticked**, and a team unticks the ones that don't apply.

- A check that applies always shows its status — Completed, On Track or Behind.
  **N/A is no longer a status these teams pick** (§3.3).
- A check that doesn't apply has no icon on the chart or in a print. It shows a
  muted "—" in the team grids and in the All grid's expanded team columns (§8.2),
  and isn't counted in any figure (§3.7). Live tooltips and the Readiness panel
  still list it, muted, as **"Not applicable"**. Nothing else lists it: approvers
  don't need a list of excluded checks (decision 33) (since phase 7, only a check that doesn't apply because of a row; one that is not selected is blank, unlisted, not counted even as not applicable and left out of snapshots, §3.9).
- **No reason is asked** for an untick (decision 32) — it would add friction.
- **Who ticks:** exactly who may write the check (§5.2) — the Wells and Logistics
  grantees for their own team's checks, and admins for any.
- **Ticks stay editable at any time**, like these teams' statuses: they don't
  freeze with the plan (§3.2).
- `readiness_required = false` stays the switch that turns **every** team's
  readiness off for one activity, Project gates included (§7.4). The tick list is
  per check.

**Granularity follows the level a check is enabled at (§3.1):**

| A check enabled at | Is ticked per | Example |
|---|---|---|
| field project only | field project | a project-only check an admin adds to Logistics |
| well only | well | a future Wells-team gate |
| both | field project, inherited by its wells — a well can make its own choice | every Logistics check |

On a well with no field project (`well_project` ""), checks enabled at both
levels are ticked per well, with nothing to inherit. Project-only checks carry
nothing there (§7.12).

**Whether a check applies is stored separately from its status**, and each
inherits on its own rule:

| On a well | Rule |
|---|---|
| **Applies?** | The well's own choice if it has one; otherwise its field project's choice; otherwise **applies**. |
| **Status** | The well's own entry; otherwise the field project's entry, **but only if the check applies to the field project**; otherwise the default. A well ticked under a field project where the check doesn't apply therefore reads the default (On Track), never the project's hidden status. This rule is applied by `readiness_effective.well_value`, by the router's `_inherited` (the status PUT's audit old value and no-change check, and Reset to project's response and audit detail — or `_inherited` is replaced with `well_value`), by the rollup's live cells and by the snapshot's `readiness_at_submission`. |

- **Unticking keeps the status underneath, and re-ticking brings it back.** A
  Completed PO unticked by mistake comes back Completed.
- **A well's own choice** is written only when it differs from its field project
  at that moment. It then stays, even if the field project later changes to
  match, until **Follow project** — or a write of the field project's current
  choice — removes it. That is the same rule as status overrides (§7.8). The grid
  marks it **"set on this well"** wherever it exists.
- **Unticking at project level reaches every well that follows its field
  project**, including wells that set their own *status*.

**Why not store "doesn't apply" as an N/A status, as the Project gates do** (considered 2026-10-23,
rejected — decision 34):
- **It loses the status.** Re-ticking could only return the default (On Track).
- **It strands wells.** Re-including a well under an unticked field project would
  write a *status* override, which would detach that well from its project's
  later status changes for good.
- **It conflicts with "No Clear action".** A project-level re-tick would need the
  entry-delete path that decision 25 ruled out.
- **It wouldn't reach every well.** A project untick would skip wells that set
  their own status (§7.8).

These problems come from inheritance, which the Logistics checks have and the
Project gates don't. That is why the gates can keep N/A.

**History.** For these teams' checks, an N/A already stored (set through the old
status menu) meant "doesn't apply", so phase 6 converts those values into unticks
(§4.4); the Project gates' N/A values stay as they are. Snapshots record an
unticked team check as N/A in `readiness_at_submission` (§6) (since phase 7, only a check that doesn't apply because of a row; one that is not selected is blank, unlisted, not counted even as not applicable and left out of snapshots, §3.9). In every revision,
old or new, an N/A team check is one that didn't apply: no icon, not counted. An
N/A Project gate keeps its grey icon.

**New checks apply everywhere** until a team unticks them, because the default is
ticked — unless the check is created "starts unticked" (phase 7, §3.9). Such a
check applies nowhere until ticked, and adding it changes no figure. A target
that read "Nothing applies" starts counting a check the moment an admin adds one
that starts ticked to that team. A **restored** check, or a reactivated team,
comes back with the ticks and statuses it had when it was retired: its rows are
kept, like its entries (§7.5).

**The tick list opens from a row, never from an icon (§8.7).**

### 3.9 Equipment checks (phase 7)

**Agreed 2026-10-24 (§9, phase 7) — built, PR pending.** Decisions 35–41 (§11).

**What changes.** Each of the 21 equipment types in §3.5's seed list becomes its
own Logistics readiness check:
- **Codes:** the plain codes — `RW`, `DSV`, … `NNRA` (decision 38).
- **Shape:** enabled at both levels, standard status set, operational like every
  Logistics check.
- **Total:** Logistics then has 27 checks: the 6 core ones plus 21 equipment
  types.
- **No sub-list:** no icon opens a list of options — §3.5's rule still holds.
- **History:** `NEQ` and its tag list stay retired and history-only.

**Equipment starts unticked** (decision 36). Ticking a type *nominates* it for a
field project, and its wells inherit that as they inherit any tick (§3.8); a well
can still make its own choice.
- **The setting:** each check carries a **"starts unticked"** setting,
  `applies_by_default`. It is fixed when the check is created, like its level and
  lock behaviour, because changing it would flip every target that has no tick of
  its own.
- **Which checks use it:** the 21 seeded equipment checks start unticked; the
  checks that exist before 039 start ticked, as in phase 6. An admin creating a
  check can choose either (§5.1).
- **Not for gates:** a check that locks with the plan has no tick list (decision
  31), so it can't start unticked — `applies_by_default` must be true.

**Not selected vs not applicable** (decision 37). Defined by state, not history:

| State | When | Shown as | Counted |
|---|---|---|---|
| **Not selected** | A check that starts unticked and reads its default: no applicability row on the target or on its field project (`applies_source: "default"`). Un-nominating a field project returns it, and every well that follows it, to this state | Nothing: no icon, a blank grid cell (not "—"), no "Not applicable" entry. Named for a target only in its tick list ("Vessels · 0 of 8 selected", where *selected* = ticked); an unfolded category's column headers name every type, as for any check | no — left out of every figure, not even as not counted (§3.7) |
| **Not applicable** | A check that doesn't apply because of a row: the target's own `applies = false`, or its field project's (`applies_source` `well` or `project`). For example, a well unticking equipment its field project nominated, or a core check unticked | "—" and "Not applicable: …", as in phase 6 | no (not counted) |

So a well that needs a crane and a lowbed shows two equipment icons, not 21 "Not
applicable" entries. Figures don't move on the day the 21 checks appear, because
a check that is not selected carries nothing (§3.7).

**Effective "applies?"** (replaces §3.8's last fallback):
- **Field project:** its own row; otherwise **the check's default**.
- **Well:** its own row; otherwise its field project's effective choice (for a
  check enabled at project level); otherwise **the check's default**.
- **A row is stored only where the choice differs** from what the target would
  otherwise read (§4.4). Nominating equipment on a field project therefore writes
  an `applies = true` row, and un-nominating it deletes that row.

**Categories** (decision 39). Every check that doesn't lock with the plan gets an
optional, admin-editable **category**. The Project gates take none, so their
seven icons, grid and prints stay as they are (decision 31).
- **Equipment categories:** Aviation, Vessels, Barges, Land transport, Lifting,
  Permits.
- **Core checks** have none.
- **Where categories show:** they group the tick list, the grids, the panel and
  the legend (§8.8).
- **On the chart and prints**, a category draws **one icon** — the worst status of
  its types that apply. The tooltip names the types. This keeps a Logistics strip
  at no more than 6 core icons + 6 category icons, instead of 27.
- **A category's icon** is the icon of its first active check by sort order. The
  seed gives every type in a category that category's icon (§3.4).
- **A folded category cell is read-only:** it opens nothing, so no icon opens a
  list of options (§3.5).

**Status words are unchanged** (decision 39): the standard set, where Completed
means the equipment is secured and Behind means it isn't available.

**Production** (decision 41) runs Project readiness only, so no Nominated
Equipment data exists there and nothing is carried over. Dev and test databases
keep their old `NEQ` values as history.

## 4. Data model

New migrations start at **034** (phase 6 adds **038**, §4.4; phase 7 adds **039**, §4.5). All tables follow
the existing conventions: UUID PKs, `""` (never NULL) as the "no name" sentinel
inside unique keys (NULLs are mutually distinct in UNIQUE constraints on every
backend we target — see `resource_registry.py`), and model/migration parity
(`test_migration_model_parity`). The sentinel was once called "not applicable";
it has nothing to do with N/A or with a check that doesn't apply (§3.8).

### 4.1 Catalog (global — not per campaign)

**`readiness_teams`**
| Column | Type | Notes |
|---|---|---|
| `code` | String(32), unique | `projects`, `wells`, `logistics` — immutable; reserved: `all`, `none` (the frontend's All / None lens names; create 409s) |
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
| `status_set` | String(16) | Code allow-list: `standard` (`availability` history only — refused for new checks since phase 6) |
| `icon_key` | String(32) | Code allow-list (§8.5) |
| `locks_with_plan` | bool | Governed (true) / operational (false) |
| `tag_list` | String(32), `""` = none | `equipment` only on the withdrawn `NEQ`; must be `""` for new checks since phase 6 (column kept for history) |
| `sort_order` | int | |
| `retired_at` | DateTime, nullable | Retire, never delete |

**`readiness_tag_items`** — dormant since phase 6: table and model are kept as
history (the `backend-mssql` CI job runs `alembic check`, so a model can't be
dropped while its table stays); no endpoint reads or writes it.
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
`(entry_id, item_code)`. Dormant since phase 6, like `readiness_tag_items`.

### 4.3 Team grants

**`user_team_grants`** — `user_id` FK, `team_code` FK, `granted_by`, `granted_at`;
unique `(user_id, team_code)`. Generic rows, **not** one boolean per team on
`User`, so Supply Chain needs no schema change. Grants are **global**: they cover
every campaign (decided 2026-10-13 — one logistics focal point; per-campaign adding
causes entry fatigue and "nobody can edit" gaps on new or cloned campaigns).

### 4.4 Applicability (phase 6)

**`readiness_applicability`** (migration **038**) — a team's choice that a check
does or doesn't apply to one target (§3.8). Only for checks that **don't lock
with the plan**: the Project gates never get a row (decision 31).

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `project_id` | FK → projects (CASCADE) | The campaign |
| `check_code` | FK → readiness_checks.code | |
| `scope` | String(8) | `project` / `well`, and the check is enabled at that level |
| `well_project` / `well_name` / `activity_type` | String(256) ×3 | Exactly as `readiness_entries` (`""` sentinels) |
| `applies` | bool | `false` = doesn't apply; `true` = applies. A field-project row is stored only where its choice differs from the check's default (`applies_by_default`): `false` for a check that starts ticked, `true` for one that starts unticked (phase 7). A well row is the well's own choice, written only where it differed from its field project at that moment; it may later match the field project (§3.8) |
| `updated_at` / `updated_by` | | As `readiness_entries` (`updated_by` FK users `SET NULL`) |

Unique `uq_readiness_applicability` on the same six columns as `uq_readiness_entry`
— the identical key already exists on SQL Server, so it fits the 1700-byte limit.

- **What a row means.**
  - **Field project:** a row exists only where the choice differs from the check's
    default: `applies = false` for a check that starts ticked, `applies = true`
    for one that starts unticked (phase 7). Writing the default deletes the row.
  - **Well:** a row is the well's own choice. It is written only when it differs
    from the field project's choice at that moment, and kept until **Follow
    project**, or a write of the field project's current choice, removes it —
    even if the field project later changes to match.
  - **No row:** a field project reads the check's default. A well follows its
    field project, or — with nothing to follow — reads the default.
  - The server applies these rules inside the write (§5.1), so a client never
    decides from a value it read earlier.
- **Renames move a status and its tick together.** Per check, the status entry
  and the applicability row at the old key move as a pair (`readiness_rekey.py`,
  §7.1). If the new key already has either one for that check, neither moves:
  both stay at the old key, logged, never silently merged. `readiness_rekeyed`
  names any moved choice, e.g. "NAV: does not apply".
- **Clone, CSV replace and name reuse.** A clone copies the rows. A CSV replace
  keeps them, because they're keyed by name. Like entries they outlive
  activities, so reusing a field-project or well name brings its old choices back
  (§7.13). **Retiring a check keeps its rows**, like its entries.

**Withdrawn checks.** A check is **withdrawn** when its status set is history-only
(`STATUS_SETS["availability"]` gains `"history_only": True`) or it has a tag list.
This is a rule in code, not a column. Consequences:
- restore → 409 (its code is already taken, so re-creating it was impossible
  anyway);
- every write treats it as retired → 422;
- clone skips its entries, tags and rows;
- creating a check with a history-only set or a tag list → 422;
- the admin catalog reports `withdrawn: true`, and the Admin page hides Restore
  for it;
- the admin catalog drops `tag_lists` and `tag_items`, and lists history-only sets
  as not pickable (the Admin form reads `status_sets` from it).

Today that means `NEQ`, and any check migration 038 retires.

**Migration 038** is bind-free: its data steps use `op.execute(...)`, never
`op.get_bind().execute`, because `test_migration_model_parity` replays `upgrade()`
against a fake bind. Step 1 uses `op.create_table`, so that test records the new
table. Every statement is built with SQLAlchemy Core:
- `sa.true()` / `sa.false()` for booleans — raw `true`/`false` isn't valid T-SQL,
  and `.is_(...)` renders `IS 0`;
- `sa.func.newid()` when `op.get_bind().dialect.name == "mssql"`, otherwise
  `sa.func.gen_random_uuid()`. The parity test's fake bind reports `sqlite`, so
  it takes the `else` branch.

Steps, in this order:

1. **Create** `readiness_applicability`.
2. **Insert an `applies = false` row for every stored N/A of a check that doesn't
   lock with the plan**, retired checks included, at the same key. The Project
   gates' N/A entries are left alone. Copy the entry's `updated_at` and
   `updated_by`. A well's own N/A under a field project that is also N/A becomes a
   well row too. It is kept, so re-ticking the project leaves that
   well unticked, as its own N/A does today.
3. **Insert `applies = true`** for every well that has its own non-N/A status
   under a field project whose entry is N/A. Today such a well applies, because
   own entries win (§3.6).
4. **Write one `readiness_applicability_migrated` audit row per campaign** that
   had any, with the count converted, plus any non-NULL notes the converted
   entries carried (none are expected: no screen sets readiness notes):
   - the id generated in SQL;
   - `project_id` = the campaign id, so it shows in that campaign's feed;
   - `entity_type` `readiness`, `entity_id` = the campaign id;
   - `field` = `readiness_applicability_migrated`, with the ASCII detail in
     `new_value`;
   - `user_id` NULL (the feed shows "Unknown").

   The step also logs any check that locks with the plan outside the Projects team
   (§3.8).
5. **Delete those N/A entries.** This must come after steps 2–4, which read them.
6. **Retire the withdrawn checks** still active (`retired_at IS NULL`): `NEQ`, and
   any other check using `availability` or a tag list (admins could create one
   since 036; there should be none). Write a `readiness_check_retired` row for
   each, the way the admin endpoint does:
   - the id generated in SQL;
   - `entity_type` `readiness_catalog`, `entity_id` = the check's id;
   - `project_id` and `user_id` NULL;
   - the ASCII detail "Retired readiness check NEQ (Nominated Equipment) -
     migration 038".

   Only active checks are touched, so an already-retired check gets no second
   event.

**Downgrade** — lossy: a status kept under an untick becomes N/A again. Steps, in
order:

1. For each well `applies = true` row whose well has no entry of its own, and
   whose field project has an `applies = false` row, insert a well entry with the
   status-set default (On Track) — what that well read (§3.8) — so it still
   applies once the project's entry becomes N/A. A `true` row under a field
   project that applies needs nothing.
2. For each `applies = false` row, set the entry at that key to N/A (keeping its
   notes), or insert one carrying the row's `updated_at` / `updated_by`.
3. For each field-project `applies = false` row, set to N/A the own entries of
   the wells under it that have no `applies = true` row. Today those wells don't
   apply, because the untick reaches them (§3.8).
4. Un-retire a check only when its latest `readiness_check_retired` /
   `readiness_check_restored` event is 038's own retirement (`user_id` NULL,
   detail ending "migration 038"), and write `readiness_check_restored` with the
   same `entity_type` and `entity_id`. A check an admin retired themselves stays
   retired.
5. Drop the table.

**Test.** The SQLite suite can't see a data migration, so a new
`tests/test_migration_038_mssql.py` covers it. It has the same `DATABASE_URL`
skip guard as `test_concurrency_mssql.py` and is added to the `backend-mssql` CI
job's pytest step, after the concurrency tests.

- It is **synchronous** — not `async def`, because `alembic/env.py` calls
  `asyncio.run`.
- Steps: downgrade to 037, seed, upgrade, check; then make post-upgrade changes —
  untick a Completed Logistics check, tick a well under an unticked field project — and
  downgrade, check, and upgrade back to head.
- It asserts that the Project gates' N/A entries are untouched, and that any
  non-NULL note on a converted entry ends up in the migration's audit event.
- PostgreSQL has no CI job: run it against PostgreSQL by hand before a PostgreSQL
  deploy.

### 4.5 Categories and "starts unticked" (phase 7)

**Migration 039** adds two columns to `readiness_checks` and seeds the 21
equipment checks.

| Column | Type | Notes |
|---|---|---|
| `category` | String(64), NOT NULL, server default `""` | Admin-editable label grouping checks within a team; `""` = none. Must be `""` for a check that locks with the plan. Not named `group`, which is a reserved word in PostgreSQL, SQL Server and SQLite |
| `applies_by_default` | Boolean, NOT NULL, server default true | "Starts unticked" = false. Fixed at creation. Must be true for a check that locks with the plan |

- **Both columns join `_DEFINITION_FIELDS`**, so a revision print groups by the
  categories frozen with it. Older catalogs don't have them, so:
  - `CatalogCheck` declares `category: str = ""` and `applies_by_default: bool =
    True` (like `tag_list`);
  - the TypeScript `CatalogCheck` makes both optional;
  - `builtin_definitions()` fills `""` / `true` for the original gates.
    `BUILTIN_CHECKS` keeps migration 034's shape, which
    `test_migration_seed_matches_the_model_seed` compares exactly.

  A missing category draws each check individually, as before.
- **Seed:** the 21 checks (§3.4), each with `applies_by_default = false` and its
  §3.4 category and icon, under the `logistics` team, with sort orders 100 and up
  so they follow the core checks.
  - A code is inserted only where it is absent (036's convention), with a Python
    `uuid.uuid4()` literal as its id.
  - Its `readiness_check_created` governance row is `INSERT … SELECT … FROM
    readiness_checks WHERE id = <that literal>`. So a code that already existed
    gets no event, and no bind is needed (the parity replay). The row has
    `entity_type` `readiness_catalog`, `entity_id` = the check id, `project_id`
    and `user_id` NULL, and a detail ending "; category <name>; starts unticked -
    migration 039".
- **Downgrade:** pre-039 code would read a "starts unticked" check as applying
  everywhere, so none may stay active.
  - Retire **every** active check with `applies_by_default = false` — the 21
    seeded ones and any an admin created since — each with a
    `readiness_check_retired` row (id generated in SQL, `entity_type`
    `readiness_catalog`, `user_id` and `project_id` NULL, detail ending "migration
    039").
  - Then drop the two columns. On SQL Server, drop each column's default
    constraint first; copy 022's `_drop_column` into 039, because migrations never
    import each other.
- **Upgrading again** after 039's own downgrade:
  - every check that is still retired and whose `readiness_check_created` detail
    ends with "; starts unticked" (§5.1), or with "; starts unticked - migration
    039" for 039's seed rows, gets `applies_by_default = false` again. A category
    may not contain ";" (§5.1), so no admin-entered text can end a detail that
    way;
  - of those, a check whose latest `readiness_check_retired` /
    `readiness_check_restored` event is 039's downgrade retirement (`user_id`
    NULL, detail ending "migration 039") also has `retired_at` cleared and gets a
    `readiness_check_restored` row (038's pattern);
  - the 21 seeded checks, found by 039's `readiness_check_created` rows, also get
    their category back from the literals, retired or not;
  - like the seed, these are bind-free `op.execute(...)` statements, because
    `test_migration_model_parity` replays `upgrade()` against a fake bind;
  - categories an admin set are lost, because the downgrade is lossy, and a check
    an admin retired stays retired.
- **SQLite and tests:** `create_all` gets the columns from the model. The seed runs
  only in the migration, like Logistics itself, so tests seed through a shared
  ORM helper.
- **Tests:**
  - a SQLite replay and a SQL Server round trip (upgrade, downgrade, upgrade) that
    ends with all 21 checks active, starting unticked and categorised;
  - `tests/test_migration_039_mssql.py` joins the `backend-mssql` pytest step
    after 038's;
  - `tests/migration_038_scenario.py` stops using `ReadinessCheck.__table__` for
    `readiness_checks` and uses an `sa.table(...)` literal with 038's columns.
    `test_migration_038_mssql.py` runs it at 037/038, where the new columns don't
    exist yet, and its final `upgrade head` now also runs 039.

## 5. API and access control

Reads stay **org-wide** (any authenticated user), per the governance model.
Writes default to deny.

### 5.1 Endpoints

| Method | Path | Who |
|---|---|---|
| GET | `/api/readiness/catalog` | Any user — teams, active checks, status sets (with severity). Tag items: removed in phase 6 |
| GET | `/api/projects/{id}/readiness` | Any user — the Project gates, one row per field project. Unchanged in phase 6 |
| GET | `/api/projects/{id}/readiness/teams/{team}` | Any user — a team's field-project rows and well rows, effective (inherited) values marked. **Phase 6:** each cell of a check that doesn't lock with the plan gains `applies` and `applies_source` (below); Project-gate cells (`teams/projects`) keep their shape |
| PUT | `/api/projects/{id}/readiness/{check_code}` | Check's editors (§5.2) — one status |
| POST | `/api/projects/{id}/readiness/{check_code}/reset` | Check's editors — Reset to project (a well's status override) |
| PUT | `/api/projects/{id}/readiness/teams/{team}/applicability` | The team's editors (§5.2) — **phase 6:** which of the team's checks apply to one target. Not the Projects team |
| POST/PATCH | `/api/admin/readiness/teams` · `/teams/{code}` | Admin |
| POST/PATCH | `/api/admin/readiness/checks[/{code}]` | Admin |
| POST | `/api/admin/readiness/checks/{code}/retire` · `/restore` | Admin — phase 6: restore refused (409) for a withdrawn check (`NEQ`) |
| POST/PATCH | `/api/admin/readiness/tags[/{list}/{code}]` (+ retire / restore) | Admin — **removed in phase 6** |
| PUT | `/api/admin/users/{id}/teams` | Admin |

**Cells (phase 6).** The team rows return each cell as a new
`TeamCheckState(CheckState)`:
- `status` — the status underneath, which re-ticking brings back;
- `applies` — bool;
- `applies_source` — `well`, `project` or `default`.

`TeamProjectRow.checks` uses it, and it is the base of `EffectiveCheckState`.
`CheckState` itself — which `ProjectReadiness.checks` (`GET /readiness`) also uses
— gains no field, so the Project gates' cells keep their shape: no `applies`, and
a gate that doesn't apply simply reads N/A. (`tags` leaves `CheckState` with
Nominated Equipment, so it leaves `GET /readiness` too.)

**One frontend helper decides whether a team cell is shown:** `applies(cell,
check)`.
- **False** when a live cell has `applies === false`, or when a frozen snapshot
  cell reads N/A and its frozen definition doesn't lock with the plan.
- **True** otherwise — and always for a Project gate, whose cells carry no
  `applies`.
- **Where it runs:** every team-check consumer drops the cells that don't apply
  *before* it rolls up, summarises or draws:
  - the callers of `worstStatus`;
  - `team-summary.ts`;
  - `chart-layout.ts` (`worstCheck`, `siblingMarker`, `barStripCodes`);
  - `readiness-lens.ts` (All) and `readiness-snapshot.ts`;
  - the All grid's `TeamWorst`, and the prints.

  An empty list then gives `undefined`: no icon, no badge.
- **Project-gate cells pass through as today**, so all-N/A gates still give "N/A"
  and the grey icon.
- **The dropped cells** are kept only for the live tooltip's and the panel's "Not
  applicable" list.
- **Unchanged:** `worstStatus`, `STATUS_SEVERITY` and `watchlist.checksReady`,
  which only ever sees Project gates.
- **The server's `figures`** count a cell that doesn't apply as not counted, and
  a parity test pins that the two agree.

The PUT keeps the **DS-001 rule**: no user text in the URL path — names travel in
the body. Body (`CheckUpsert` in `app/schemas/readiness.py`, Pydantic v2):

```json
{ "scope": "well", "well_project": "Egbema Node FOD + IOGD",
  "well_name": "EGB-12", "activity_type": "Oil Development",
  "status": "Behind", "notes": null }
```

Validation:
- `scope` ∈ {project, well}, and the check is enabled at that level. Otherwise
  422 — from phase 6 the message reads "This readiness check isn't used at that
  level".
- Names:
  - `well_project` is 1–256 characters for scope `project`, and 0–256 for scope
    `well` (`""` = no field project);
  - `well_name` / `activity_type` are 1–256, required if and only if
    `scope = well`.
- `status` ∈ the check's status set; `notes` ≤ 512.
- *Until phase 6:* `tags` only when the check has a tag list; each code must be an
  **active** item of that list; deduplicated; ≤ 50; `null` = leave unchanged,
  `[]` = clear.
- `check_code` must be an active catalog check (retired or withdrawn → 422).
- **Phase 6:**
  - the admin catalog's matching message reads "A check that locks with the plan
    is set at project level only";
  - `status` "N/A" on a check that doesn't lock with the plan → 422 ("Untick the
    check instead"). The Project gates still accept N/A, as today;
  - a status on a team check that doesn't apply to the target → 409 ("This check
    doesn't apply here — tick it first"), and Reset to project on such a check →
    409 too (§7.10);
  - `tags` and any unknown field → 422 (`extra = "forbid"`).
- **BOLA:** the target must exist in *this* campaign — a project scope needs ≥1
  activity with that `well_project`; a well scope needs ≥1 activity matching all
  three names. Otherwise 404 with a generic message.

**Applicability write (phase 6)** — `PUT /api/projects/{id}/readiness/teams/{team}/applicability`.
The path carries only the team code, never a name (DS-001). Body
(`ApplicabilityUpdate`, `extra = "forbid"`):

```json
{ "scope": "well", "well_project": "Egbema Node FOD + IOGD",
  "well_name": "EGB-12", "activity_type": "Oil Development",
  "applies": { "PO": false, "NAV": true, "CTR": null } }
```

- `team` must be an active team, else 404. The Projects team → 422 ("The Project
  gates use N/A").
- `applies` holds 1–50 entries, each `{code: true | false | null}`. Each code must
  be an **active, non-withdrawn check of that team** that doesn't lock with the
  plan, enabled at the target's level, else 422. Only the listed codes change, so a client with a stale catalog
  can't untick a check it doesn't know about.
- **What each value does** (resolved under the lock, against the target's
  *current* state — §4.4):
  - **Field project:** `true` deletes its row; `false` writes `applies = false`;
    `null` → 422.
  - **Well:** `true` / `false` set the well's choice. A row is stored only if the
    choice differs from the field project's current choice; otherwise any row is
    removed. `null` is **Follow project**: it deletes the well's row, whatever the
    field project says now.
  - **A value that changes nothing** — neither the effective value nor the well's
    row — writes nothing and no audit event. Removing a well's row is a change, and
    is audited ("<code>: set on this well -> follows field project; for <target>").
- Target fields, bounds and the BOLA rule are as for the status PUT.
- The whole request is **one transaction** — every listed code changes, or none
  does.
- **The response** is the target's new cells. For a field project it also includes
  the cells of every well row under it, because those wells follow it. For a well
  with a field project it is that project's row and every well row under it (since
  2026-10-25 — the project's figures fold in its wells, §3.7); a well with no
  field project returns its own row only. The picker redraws from it; other open
  views refetch.
- **Phase 7:**
  - **Field project:** a value equal to the check's default deletes its row, the
    other value writes it, and `null` → 422. In `_set_project_choice`, `before` is
    the row's value or else `applies_by_default`. The delete branch is `want ==
    applies_by_default`, the only case where a row is sure to exist (phase 6's
    `assert row is not None` would fail on a check that starts unticked).
  - **Not selected** (§3.9): such a cell comes back with `applies: false,
    applies_source: "default"`. One frontend helper decides it: `notSelected(cell)`
    = `cell.applies === false && cell.applies_source === "default"`, and
    `ReadinessCell` gains `applies_source?`.
    - `applies()` is unchanged and returns false for it.
    - `teamDetails` drops not-selected cells, so `notApplicableLine`,
      `summariseTeam().notApplicable`, the chart tooltips and the panel's "Not
      applicable (N)" never name them.
    - Two views build their lists without `teamDetails` and filter with
      `notSelected` themselves:
      - DrillChart's team-lens tooltip drops not-selected cells from `naCodes`;
      - `ActivityReadinessPanel` drops them from both `notApplicable` and `shown`
        (`shown` is every check not in `notApplicable`, so otherwise they would
        come back as On Track rows). Its field-project column draws a blank, not
        "—", for a field project's not-selected cell.
    - The team grids and the All grid's expanded columns draw a blank cell, not
      "—".
    - `pickerRows` replaces its three `?? true` fallbacks with `??
      (check.applies_by_default ?? true)`: the field is optional (§4.5), and a
      definition without it starts ticked. `applicabilityBody` has no check in
      scope; since a field project never sends `null`, it drops a `null` entry
      instead of sending `true`.
    - The docstrings of `TeamCheckState` and `api/readiness.ts` change "the default
      (applies)" to "the check's default".
  - **Figures:** the server's `figures` leave not-selected cells out entirely — not
    even as not counted (§3.7).
- **Catalog (phase 7):**
  - `CatalogCheck` and `AdminCatalogCheck` gain `category` and
    `applies_by_default`.
  - `CheckCreate` takes both. It refuses `applies_by_default: false`, or a
    non-empty `category`, with `locks_with_plan` (422).
  - `CheckUpdate` takes `category` (audited like a label change; 422 on a check
    that locks with the plan) but not `applies_by_default`. `_at_least_one`
    counts it.
  - `category` is `Annotated[str, StringConstraints(strip_whitespace=True,
    max_length=64, pattern=r"^[^;]*$")]`, so `""` clears it (not `Label`, which
    needs at least one character). Checks group by exact text within a team, and
    the Admin form suggests existing categories so spellings stay one.
  - A category may not contain ";" — `CheckCreate` and `CheckUpdate` both refuse
    it (422). ";" separates the parts of the `readiness_check_created` detail,
    and 039's re-upgrade reads that detail's ending (§4.5).
  - The `readiness_check_created` detail adds `; category <name>` when one is set,
    then `; starts unticked` when `applies_by_default` is false — including 039's
    seed rows.

### 5.2 Authorization — new helper in `app/core/rbac.py`

`assert_can_edit_check(project_id, *, team_code, editor_source, user, db)`
(keyword-only), called in every readiness write right after the check or team is
resolved (step 0 below), before the campaign lock and any campaign read:

1. Global admin → allow (existing bypass, preserved).
2. `team.editor_source == "planner"` → `assert_member(project_id, user, db,
   allowed_roles={ProjectRole.planner})` — **unchanged behaviour** for project gates.
3. `team.editor_source == "team_grant"` → the user holds a `user_team_grants` row
   for the check's team; otherwise **403** `"Insufficient role for this action"`.

A team grant writes **only that team's checks**: no schedule edits, no project
gates, no submit/sign/approve. Then, only if `check.locks_with_plan`:
`assert_project_not_locked` → 423.

**Phase 6 order, for every readiness write** (status PUT, reset, applicability).
Body validation comes first (422), then:

0. resolve the active check (status PUT and reset → 422) or the active team
   (applicability → 404). The catalog is public, so this leaks nothing;
1. `assert_can_edit_check` with that check's team;
2. `lock_campaign_writes` — the campaign write lock that activity writes and
   revision submit already take (`app/core/locks.py`). It closes two existing
   races: a Project-gate status write committing between a submit's snapshot and
   its lock, and two first writes to one target colliding on the unique key (a 500
   today);
3. the remaining validation, and BOLA;
4. for a status PUT or reset on a check with `locks_with_plan`,
   `assert_project_not_locked` → 423, with nothing written. This is gated per
   check, as today. The applicability write never touches such a check (it
   returns 422 instead), so it is never refused with 423;
5. writes, then audit, then one commit.

**The 423 messages.** The shared `_PROJECT_LOCKED_DETAIL` and
`_ACTIVITY_LOCKED_DETAIL` in `app/core/locks.py` change to "…locked by a revision
(pending or approved)…", along with the docstrings of `ensure_activity_unlocked`
and `assert_project_not_locked`. Today they say "awaiting approval", which is
wrong for every caller, because approval keeps the plan locked.

Catalog and grant endpoints require `is_admin`.

### 5.3 Audit

- **Catalog changes** (check create, edit, retire; tag items until phase 6) and **team grant/revoke** —
  `governance_event`, `project_id NULL`, new `ENTITY_READINESS_CATALOG`; grants use
  `ENTITY_USER` with `team_grant_granted` / `team_grant_revoked`, mirroring
  `can_plan_granted`.
- **Entry changes** — today `updated_by` keeps only the **last** editor. With
  global grants spanning every campaign, each entry change also writes an audit
  event (`readiness_updated`, old → new status, and tags until phase 6; `project_id` set), so the
  full history is visible in the campaign audit feed. Append-only, as always.
- **Applicability changes (phase 6)** — one `readiness_applicability_changed`
  event per check whose value changed. None for a listed code that changed
  nothing, and none for a request refused with 403, 409, 422 or 423.
  - `entity_type` is `readiness`; `entity_id` is the applicability row, or the
    deleted row's id when a choice is removed.
  - The detail is ASCII, in plain words and capped at 512 characters like other
    readiness details: `NAV: applies -> does not apply; for Bonga Phase 3`, or
    `PO: follows field project -> does not apply; for EGB-12 (Bonga Phase 3, Oil
    Development)`.
  - The feed shows it as "Readiness NAV: applies → does not apply; for Bonga
    Phase 3".
- **Phase 7:** the state with no row is the check's default, which reads `not
  selected` for a check that starts unticked. Examples: `PSV: not selected ->
  applies; for Bonga Phase 3`, and `PSV: applies -> not selected; for EGB-12 (no
  field project, Oil Development)`. In code, `_set_well_choice`'s `label(None)`
  with nothing to follow, and `_set_project_choice`'s missing row, use the check's
  default ("applies" or "not selected"), never a fixed "applies".
- The audit feed shows the newest 100 events. A large untick, or the migration's
  per-campaign events, can push older submit or sign events out of that view; the
  feed's limit or paging is a follow-up (§13).
- Logs carry ids only (no names or emails), per the logging rules.

## 6. Snapshot, diff and history

The snapshot stays a **flat activity list**, so existing readers keep parsing.

| Snapshot key (per activity) | Content | Change |
|---|---|---|
| `readiness` | Governed project gates `{code: status}` | **Unchanged shape**; now built from catalog checks with `locks_with_plan`. Unchanged in phase 6: an N/A gate is recorded as N/A |
| `readiness_at_submission` | Operational checks, **effective** values `{code: {status, source: well\|project\|default}}`, plus `tags` for a check with a tag list | **New**; absent in older revisions. (`inherited_tags` was never stored.) Phase 6: a check that doesn't apply is recorded with status `"N/A"`; no new snapshot carries tags |

- **Phase 7:** a check that is **not selected** (§3.9) is left out of
  `readiness_at_submission`, as an omitted cell is (§3.7). A check that doesn't
  apply because of a row (the target's own or its field project's) is still
  recorded as N/A.
- **Catalog as of submission:** new nullable `revisions.catalog_json` stores the
  definitions (labels, team, status set, icon) used by that snapshot. Older
  revisions have `NULL` → readers fall back to the built-in definitions of the
  original 7 gates. Renaming or retiring a check never changes how a past
  revision renders.
- **Diff:** compares governed `readiness` only (as today). Operational values are
  shown, not diffed — they change daily and would bury real plan changes.
- **Compare is unchanged in phase 6** (decision 33). The backend reports
  `Readiness: <code>` changes, but no screen shows them, and `readiness_required`
  isn't diffed. Both remain future ideas (§13).
- **`_readiness_pct`** (diff KPI) keeps reading `readiness`, but computes it per
  §3.7 — each field project once, not once per activity (changed 2026-10-16).
- **Clone:** copies all entries and tags along with the activities, as
  `projects.py` copies gates today. Phase 6: it also copies applicability rows,
  and skips entries, tags and rows of withdrawn checks (`NEQ`), so dead data stops
  travelling into every new campaign. A check that is merely retired, and may be
  restored, is still copied.
- **CSV replace:** entries survive a replace (keyed by names), as gates do today.

## 7. Edge cases and rules

1. **Renames carry checks over.** When an activity edit changes `well_project`,
   `well_name` or `activity_type`, and no other activity still carries the old
   key, its entries are re-keyed to the new one. If the new key already has
   entries, those win and the old ones stay orphaned (logged as a warning — no
   silent merge). This also fixes today's orphaning of project gates when every
   activity in a field project is renamed. Phase 6: per check, the status entry
   and its applicability row move as a pair; if the new key already has either
   one, neither moves (§4.4).
2. **Duplicate key:** two activities with the same project + well + activity type
   in one campaign (e.g. two workovers) share well entries. Import and the
   activity form show a **warning** (not a block).
3. **No well name** (Rig Idle, Contracting): no well gates — mirrors "no project →
   no project gates".
4. **Readiness opt-out:** `readiness_required = false` hides **all** teams' dots
   for that activity and drops it from every team's KPI (decision 16).
5. **Retired checks:** hidden from the grid and the pickers; stored entries kept;
   still rendered in past revisions via `catalog_json`.
6. ~~**Retired equipment types:** stay on entries that already have them (shown
   struck through); cannot be newly added.~~ Withdrawn 2026-10-23 (§3.5):
   equipment names are no longer shown anywhere.
7. **Locked campaign:** governed dots are disabled (as today); operational dots stay
   editable — the lock banner must say **"project gates frozen"**, not "readiness
   frozen".
8. **Overrides:** a well override survives later changes to the project value
   (that is its purpose); the grid flags overridden cells so a stale override is
   visible, and "Reset to project" is one click. Changing a project value never
   rewrites well overrides.
9. **Unticking a team check at project level (phase 6)** reaches every well that follows its
   field project, wells with their own *status* included. A well that differs
   keeps its own choice — marked "set on this well"; **Follow project**
   removes it.
10. **No status edits on a team check that doesn't apply (phase 6):** the status PUT
    and Reset to project both return 409 — tick it first. Re-ticking shows the
    status kept underneath.
11. **New checks apply everywhere (phase 6)** unless they are created "starts
    unticked" (phase 7, §3.9). A target with no row of its own, and no
    field-project row to follow, reads the check's `applies_by_default` (§3.9). A restored check, or a reactivated team, comes back with
    the ticks it had when it was retired.
12. **Project-only checks on a well with no field project carry nothing** — in
    live views, as already in snapshots (§3.7, phase 6).
13. **Name reuse (phase 6):** applicability rows, like entries, outlive
    activities. Reusing a field-project or well name in the same campaign brings
    back its old ticks and statuses.
14. **Withdrawn checks** (`NEQ`, phase 6) can't be restored, re-created or written;
    their code stays reserved, like `CON`.
15. **Un-nominating on a field project (phase 7)** returns every well that follows
    it to not selected. A well that ticked the type itself keeps it ("set on this
    well"). A well that unticked it keeps its `applies = false` row and still reads
    "Not applicable" until **Follow project**.
16. **A well can nominate equipment its field project didn't (phase 7):** that is
    an `applies = true` well row, exactly as in phase 6.
17. **Retiring an equipment check** keeps its rows, as for any check (§4.4).

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
- **Overview and Presentation (2026-10-18).** The Overview's Readiness group (one
  card per team, one window) has a team picker too — "All teams" by default, so
  the campaign's full picture is what opens; a focused Overview says so ("Focused
  on Logistics · 1 other team hidden · Show all") and is remembered per browser
  and carried in `?lens=`. The Presentation page follows the chart's lens (its
  link carries `?lens=`) and names it ("Readiness: Logistics"). A card's
  "N behind" opens the Readiness tab with `?focus=behind`: only the field
  projects / wells with a check behind.

### 8.2 Readiness page

- **Project gates** — today's grid, unchanged in phase 6 (decision 31): N/A stays
  in the menu, and an N/A gate shows the grey icon.
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
- ~~`NEQ` cell opens a picker: grouped multi-select (by category) + Available /
  Not available; inherited project tags shown greyed "from project".~~
  Withdrawn 2026-10-23 (§3.5).
- **Phase 6, team grids (Wells, Logistics, future teams) and the All grid's team
  groups:** a team check that doesn't apply shows a muted "—" ("Not applicable")
  in its column (since phase 7, only a check that doesn't apply because of a row; one that is not selected is blank, unlisted, not counted even as not applicable and left out of snapshots, §3.9), so the columns keep their place. A folded team cell is the worst
  of the checks that apply, and "—" when none does. Each team-grid row gets the
  **Checks…** control (§8.7); the All grid stays read-only.
- Dots are editable only where the user can write (§5.2) — the API stays the
  authority.

### 8.3 Chart and dashboard — keeping "All" clean

- **Single-team lens:** that team's icons only, using the chart's existing width
  tiers (full strip → half → grid → single worst icon). `chart-layout.ts` sizes the
  tiers from the lens's check count instead of a fixed 7. **Phase 6, team lenses
  (Wells, Logistics…):** a bar draws only the checks that apply to it, packed left
  in catalog order (the All-lens rule), with the tiers sized by the number drawn.
  An icon is told by its shape, not its position. A bar where nothing applies
  draws no strip. **The Project gates lens is unchanged:** all seven icons, an N/A
  gate in grey.
- **All:** one **team badge** per team per bar (3 today, 4 with Supply Chain) —
  the team's icon, coloured by that team's **worst effective severity** (§3.7).
  Narrow bars collapse to a single badge (worst overall). Hovering lists every
  check grouped by team; clicking a badge switches the chart to that team's lens.
  (As shipped in phase 4: the tooltip shows each team's worst status, "X of Y
  done" and the checks that need attention, and badges don't switch lens.)
  The legend shows the team badges plus the severity colours. **Phase 6:** a team
  badge is the worst of the checks that apply; a team where nothing applies gets
  no badge. The tooltip lists unticked team checks muted ("Not applicable: NAV,
  PO") (since phase 7, only a check that doesn't apply because of a row; one that is not selected is blank, unlisted, not counted even as not applicable and left out of snapshots, §3.9), and such a team reads "Nothing applies". The Project gates badge is
  unchanged — grey when every gate is N/A.
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
- **Phase 6, team lenses:** prints draw only the checks that apply, packed left.
  Icon size still comes from the lens's check count (from phase 7: its
  uncategorised checks plus its categories, §8.8), so a lone icon doesn't grow.
  An N/A team check in an older revision is one that didn't apply, so it isn't
  drawn. **Project gates prints are unchanged** — grey N/A icons included.
- **Phase 6 legends:** a legend lists the statuses its icons can show.
  - The Project gates' list and the All lens's list include N/A, because the All
    lens's Project gates badge can be grey; a team lens's list doesn't.
  - `teamSummaryCheck` gives the Projects badge `locks_with_plan: true`, because
    `ChartLegend` and `ReadinessKey` derive the list from `useLensChecks()`.
  - A revision print also lists any other status its snapshot draws — for example
    NEQ's Available / Pending / Not available.

### 8.5 Icons and output encoding (security)

- **Phase 7 — more icons** (decision 40). The owned registry grows from 15 to 68
  keys; every new key comes from lucide, which is already a dependency. Eleven
  groups (`ICON_GROUPS` in `icon-registry.ts`), each in registry order, so the 15
  earlier keys lead their group:
  - **Sites and planning:** land-plot, map-pin, drafting-compass — earlier gate
    icons that fit no other group.
  - **Rigs and engineering:** rotary-table, drill, pickaxe, wrench, hammer, gauge,
    cable, plug-zap, factory, warehouse.
  - **Marine:** ship, anchor, container, ship-wheel, sailboat, life-buoy, waves.
  - **Aviation:** helicopter, plane.
  - **Land transport:** truck, bus, bus-front, van, car, tractor, caravan.
  - **Lifting:** forklift, construction, hard-hat.
  - **Permits and safety:** shield-check, radiation, biohazard, siren, shield-user,
    id-card, key, stamp.
  - **Documents and finance:** gavel, banknote, hand-coins, file-signature,
    receipt, file-check, file-text, clipboard-check, clipboard-list,
    calendar-check, badge-check, landmark, wallet, coins, scale.
  - **People and community:** handshake, users.
  - **Environment:** leaf, mountain, tree-pine, droplets, flame, fuel, wind,
    thermometer, cloud-rain.
  - **Comms:** radio, satellite-dish.
- **Kept in sync by a generator:**
  - **The script:** `frontend/scripts/gen-check-icons.mjs` (committed, no new
    dependency) reads each key's `__iconNode` from
    `node_modules/lucide-react/dist/esm/icons/<lucide name>.js`. It writes
    `LUCIDE_PATHS`, which the chart's canvas icons and tooltips use; prints draw
    the React icons.
  - **Exceptions:** it maps aliases to their lucide file (`file-signature` →
    `file-pen-line`) and leaves the hand-drawn `rotary-table` as written.
  - **Visible change:** regenerating redraws LOC, FE and FID to lucide 0.577's
    shapes, which the React icons already use.
  - **Node:** the script needs a Node version with ESM detection (≥ 20.19 / 22.12).
  - **Tests:** a vitest renders every `CHECK_ICONS` component with
    `react-dom/server` and compares it with `LUCIDE_PATHS` (except
    `rotary-table`). The existing parity tests keep the backend `ICON_KEYS` and
    `icon-registry.ts` identical, in order.
- **Admin icon picker:** a search box, plus groups as above (`IconPicker.tsx`).
  - Every key is in exactly one group; within a group keys keep registry order.
  - The groups only lay out the picker. They are never an allow-list —
    `ICON_KEYS` is.
  - A key the server offers that this build doesn't group (a newer catalog)
    shows under **Other** rather than vanishing.
  - Search matches icon names and group names: "ship" finds ship and
    ship-wheel, "marine" the whole Marine group.
- **Still owned:** admins choose a key; they never upload SVG.

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

### 8.7 The "Checks that apply" picker (phase 6)

- **Where:** a **Checks…** control on each field-project row and well row of the
  team grids (Wells · Logistics · future teams — not the Project gates), and on
  each of those teams' sections of the per-activity Readiness panel. It opens
  from the row, never from an icon (§3.5).
- **What:** the team's active checks that don't lock with the plan, with ticks, ticked by default except checks that start unticked (phase 7, §3.9) — it looks
  like the old equipment picker. **Save** sends one request (§5.1): all or
  nothing, with a toast on 403.
- **On a well:** a tick inherited from the field project reads "from project". A
  well's own choice is marked **"set on this well"** wherever one exists, with
  **Follow project**. Project-only checks show read-only on well rows ("set on the
  field project").
- **No field project to follow:** for a well-only check, or a well with no field
  project, the tick is plain — no source label, no Follow project. Project-only
  checks are left out on a well with no field project.
- **In the per-activity panel,** **Checks…** edits the well for teams with
  well-level checks, where project-level ticks show read-only "from project". It
  edits the field project for a team with only project-level checks.
- **On a field project:** "Applies to its wells unless a well has its own choice",
  plus how many wells have one. Today the grid's status line reads "applies to
  its wells unless a well differs"; both change to "has its own choice", because a
  well's choice can come to match its project. (Since the 2026-10-25 layout
  update, §8.8, the grid says it once, above the Field projects table — "A field
  project's ticks apply to its wells unless a well has its own choice." — not on
  every row; the tick list still says how many wells have their own choice.)
- **Unticked checks:** "—" in grid cells (title "Not applicable"); in the
  Readiness panel, under a collapsed **Not applicable (N)** (since phase 7, only a check that doesn't apply because of a row; one that is not selected is blank, unlisted, not counted even as not applicable and left out of snapshots, §3.9).
- **Status menus** of team checks offer On Track, Completed and Behind only.
  Reset to project is unchanged. The menu list is derived in code from the
  `STATUS_SETS` mirror and the `locks_with_plan` of the definition the view
  rendered from (the team rows' `checks`, §3.3) — never from `checkDefOf`'s
  unknown-code fallback, which reads as a governed gate. **The Project
  gates' menus keep N/A**, and the Project gates grid, the chart edit dialog's
  gates and the Activities grid strip are unchanged.
- **Wording:** team-check views say "Not applicable" for a check that doesn't apply because of a row (since phase 7, never for one that is not selected, §3.9), and
  "Nothing applies" for a target where no check of the team applies.
  - `team-summary.ts` says "Nothing applies" for team checks; the Project gates
    keep today's "Nothing applies (all N/A)".
  - `ReadinessSummary`, which the Project gates grid and the team grids share,
    labels its not-counted count "not applicable" in the team grids and keeps
    "N/A" for the Project gates. `READINESS_FIGURES_HINT` does the same.
- **Admin page:** the status-set select offers active sets only; the tag-list
  select and the Equipment types section go; Restore is hidden for withdrawn
  checks.

### 8.8 Categories in the UI (phase 7)

- **Tick list (Checks…):**
  - **Layout:** a search box (code or label) above the list; the team's core
    checks first, then one collapsible group per category with a tri-state
    "select all" and "n of m selected". Groups with nothing selected start folded.
  - **Search:** filtering hides rows but keeps their choices; the footer says
    "Showing 5 of 27 · 2 unsaved changes".
  - **Scrolling:** only the list scrolls; the header and **Save** stay in view.
  - **No pagination:** a save covers every tick, so every tick must stay
    reachable before Save.
  - **Button text:** on every row and panel section, the **Checks…** count covers
    only the checks that start ticked, as in phase 6 ("5 of 6" when one is
    unticked). Nominations show separately ("· 2 selected"), and checks that are
    not selected never count against the total (decision 37). A row with nothing
    unticked and nothing nominated reads just "Checks…", so no row shows a count
    on deploy.
- **Team grids:**
  - **Frame (layout update, 2026-10-25):** the Project gates page's, so the lenses
    read as one page — the drill-through banners (now "N shown — wells with a
    check behind" / "… with readiness-required work starting in the next N
    months", with Clear filter), the **Readiness Tracker** toolbar (Refresh, the
    window, search, and "6 wells" / "2 of 6"), then the two-section key (Status ·
    Readiness checks). Shared code: `ReadinessToolbar`, `ReadinessLegend`,
    `DoneFigure`.
  - **Views (2026-10-25):** one table at a time — a **Projects | Wells** switch in
    the toolbar (`team-view.tsx`), Projects by default (where a team nominates and
    sets what wells inherit). Everything follows the view: the table, the count
    ("3 projects" / "5 wells"), the summary (§3.7), the banners, the window's All
    label ("All field projects" / "All wells"), the search and the key (the view's
    checks; a category keeps its full-definition icon). The view is in the link
    (`?view=`, which wins), else remembered per team in this browser, else
    Projects; a team with checks at one level has that view only, no switch. Each
    project row has **Wells →**: the Wells view narrowed to that project
    (`?project=`, banner "N shown — wells of Bonga Phase 3", Clear filter); the
    narrowing lasts one visit — the switch or a lens change drops it. The
    Overview's team tiles and their "N behind" open the view of what they count
    (`view=` the tile's `unit`, whatever was remembered): the Projects view, or the
    Wells view for a team whose checks are all well-level; the All grid's Open
    opens the Wells view (its rows are wells). A lens change drops the view, so
    each team opens on its own.
  - **Pinned column:** the field-project / well column stays put when the grid
    scrolls sideways.
  - **Columns:** core checks are individual columns. Each category is **one folded
    column**: its icon plus the worst status of its types that apply, or blank when
    none applies. As on the Project gates page the layout is fixed: the first
    column (20rem) and **Done** (the row's done ÷ counted, from its server
    figures; "—" with "Nothing applies" when nothing counts) keep their width, and
    the check and category columns share the rest evenly — down to 3.75rem each,
    below which the table scrolls sideways (a category unfolded on a narrow
    screen). A folded category's header is its icon and type count; its name is
    in the key's chip, the hover and the button's label. Unfolded over two or more
    types, the header names the category.
  - **Unfolding:** click a category header to show its types. In an unfolded
    category, a type that is not selected is blank and one that is not applicable
    shows "—". A folded category cell is read-only — it opens nothing (§3.5). The
    fold state is remembered per browser.
  - **Rows:** search and pagination are unchanged.
  - **Key:** core checks as code and label, then **one chip per category** — its
    icon, name and type count; its types and their labels show on hover (and to
    screen readers). Changed 2026-10-25 from one line listing every type, which
    grew the key taller than the grid once the 21 equipment types arrived; the
    columns already show every category. Prints keep their type list (paper has
    no hover).
- **All grid:** an expanded team group shows its core checks as columns and each
  category as one folded column (its icon and type count), as the team grids do.
  It stays read-only.
- **Readiness panel:** core rows as today, then one sub-section per category,
  folded to "Vessels · 2 selected · 1 behind". "Not applicable (N)" lists only
  checks that don't apply because of a row (§3.9), never ones that are not
  selected.
- **Chart (team lens):**
  - **Strip:** core checks that apply, then one icon per category with at least
    one type that applies. The tier is sized by the icons drawn (≤ 12 for
    Logistics).
  - **How it's built:** `chart-layout.ts` builds one synthetic strip check per
    category before `barStripCodes`, `worstCheck` and `siblingMarker` run. Its
    icon is the first active type's, and its cell is the worst of its types that
    apply (none when no type applies). So the single-icon tier and the marker on a
    project's other bars also show the category.
  - **Tooltip:** core lines as today, then one line per category naming its types,
    worst first ("Vessels (2): PSV Behind · DSV On Track"). "Not applicable" lists
    only checks that don't apply because of a row, capped at 6 codes + "+N more".
  - **Legend:** core checks plus one entry per category.
- **All lens:** the Logistics badge is the worst of everything that applies, as
  today; its summary line names types.
- **Prints:** the same roll-up as the chart. A strip's column count is the number
  of checks with no category plus the number of categories in the lens's
  definitions (the frozen catalog on a revision print), not the full check count —
  12 for the seeded Logistics.
- **Admin:**
  - **Create:** the check form gains **Category** (free text, suggesting existing
    categories) and **Starts unticked** (fixed after creation). Both are hidden
    for checks that lock with the plan.
  - **Edit:** the form lets the category change.
  - **List:** grouped by category within each team.

## 9. Build phases

Each phase ships on its own to `main`, with tests, keeping the suite green.

| Phase | Delivers | Visible change |
|---|---|---|
| **1. Catalog refactor** — ✅ **shipped 2026-10-13** | Catalog tables (incl. `readiness_teams`, seeded with the `projects` team) seeded with the 7 gates (same codes, labels, icons); `project_readiness` → `readiness_entries` data migration (034); backend and the §8.6 files read the catalog; `revisions.catalog_json`. | **None.** Riskiest step, so it ships alone. Tests: snapshot JSON identical before/after; pre-change revisions render; diff unchanged. |
| **2. Teams and grants** — ✅ **shipped 2026-10-13** | `user_team_grants` (035), `assert_can_edit_check`, Admin page team grants + catalog management, audit events (§5.3), entry-change audit. | Admin page only. |
| **3. Well scope + lenses** — ✅ **shipped 2026-10-13** | Well-keyed entries, team lens API + grid (field-project and well rows), lens selector on the Readiness page, chart and sequence print with per-user default (§8.1, §8.4), rename carry-over (§7.1), shared-key warning in the grid, operational lock behaviour. **Moved forward from Phase 4:** project → well inheritance with override + "Reset to project" (§3.6) — admins could already create two-level checks in Phase 2, so the well grid needed it. **Deferred to Phase 4:** the lens on the *revision* print (needs `readiness_at_submission`), the All view, dashboard team tiles; the data-grid strip stays on project gates. | Lens picker appears once a second team exists; planners can print "project gates only". |
| **4. Logistics + All** — ✅ **shipped 2026-10-14** | Migration 036 seeds the Logistics team + 7 checks (codes confirmed) + 21 equipment types; `availability` status set; `NEQ` tags (project ∪ well); `readiness_at_submission` + lens on the revision print (pinned to the frozen catalog); All view (grid with foldable team groups, chart team badges, print); dashboard team tiles; opt-out hides all teams. **Simplified:** the All grid is read-only (a group's *Open* switches to that team to edit); the chart's All tooltip lists each team's worst status rather than every check, and badges don't switch lens on click; the Breakdown "by gate" team selector is deferred. | Logistics live; All view. |
| **5. Rollups (§3.7)** — ✅ **shipped 2026-10-16** (`app/services/readiness_rollup.py`) | Three steps: **(1)** one backend rollup service; **Pending** in the equipment status set as its default (backend, picker, legend); the Overview tiles (Project gates tile = Projects team tile), the last-approved tile and the revision compare % on it. **(2)** Readiness tab and team grids: the three figures over exactly the rows shown, the window filter, links that carry the window, opted-out and completed field projects hidden. **(3)** Chart marker on `blocked` severity; the admin catalog refuses governed checks outside the Projects team; snapshots follow the no-field-project / no-well-name rules. Tests include a backend/frontend parity test. | One set of figures everywhere ("50% complete · 83% on track · 1 behind"); Overview readiness drops wherever gates were only partly set; unset equipment reads amber Pending instead of red Not available. |
| **6. Checks that apply (§3.8)** — built on branch feature/readiness-checks-that-apply (PR #24, open) | **Backend:** `readiness_applicability` + migration 038 (N/A → unticks, `NEQ` retired, audited, tested on SQL Server); effective values, rollup, snapshot, re-key and clone read it; the team rows return `applies` per cell; the applicability endpoint (§5.1, not the Projects team); the status PUT refuses N/A on team checks (422) and a status on a team check that doesn't apply (409); every readiness write takes the campaign write lock; `NEQ` withdrawn (restore and create refused), `availability` and tag lists history only, tag endpoints removed; project-only checks carry nothing on wells with no field project. **Frontend:** the picker (§8.7) in the Wells and Logistics grids and the panel; team-check status menus without N/A; team lenses, prints, tooltips and team badges draw only what applies; equipment UI removed. **Project gates unchanged** (decision 31). **One branch and one PR:** the API change (no `tags`; no N/A on team checks) needs both stacks together. PRs are rebase-merged, so the commit that refuses N/A on team checks and drops `tags` must also remove them from the frontend (or merge this PR with squash). | Wells and Logistics tick which checks apply; N/A leaves their menus; their unticked checks leave the chart and prints; Logistics drops to six checks and its figures move. The Project gates look and work as before. |
| **7. Equipment checks (§3.9)** — built on branch feature/readiness-equipment-checks (PR pending) | **Backend:** migration 039 (`category`, `applies_by_default`, the 21 seeded opt-in checks, audited; downgrade retires every check that starts unticked); effective "applies?" falls back to the check's default; not-selected cells carry nothing (figures, snapshots); applicability write compares with the default; catalog/admin fields; 53 more icon keys (68 in all), generated chart paths. **Frontend:** grouped and searchable tick list; grid category columns folded by default with a pinned first column; panel sub-sections; chart, legend, prints and tooltips roll categories up; admin Category + Starts unticked fields and a searchable icon picker; generated icon paths. | Logistics gains 21 equipment types that start unticked; ticking one nominates it; figures don't move on deploy. Admins get 68 icons. |
| **Supply Chain** | Admin adds a team, checks and grants. | **Configuration only.** |

Per `CLAUDE.md`, each backend phase adds denial tests for the new paths: non-grantee
→ 403; Wells grantee writing a logistics check → 403; planner writing a logistics
check → 403; admin bypass → 200; governed check while locked → 423; operational
check while locked → 200; retired check → 422; inactive tag → 422; unknown well in
campaign → 404; user text never in the URL path.

Phase 6 adds:
- **Who:**
  - a non-grantee unticking a Logistics check → 403;
  - a grantee of another team (Wells) unticking a Logistics check → 403;
  - a planner unticking a Logistics check → 403;
  - admin → 200.
- **Locks:**
  - an untick while the plan is locked (pending or approved) → 200, because team
    checks stay live;
  - a Project-gate status write while approved → 423 — no test covers a readiness
    write on an approved plan today, and phase 6 touches that path.
- **Refusals:**
  - another team's code in the body → 422;
  - a check not enabled at the target's level → 422;
  - a retired check → 422;
  - an unknown target → 404, including a name that exists only in another
    campaign;
  - `null` (Follow project) on a field project → 422;
  - a withdrawn check in the body → 422;
  - the Projects team, or any check that locks with the plan, in an applicability
    write → 422;
  - status N/A on a team check → 422, while N/A on a Project gate is still
    accepted;
  - a status, or Reset to project, on an unticked check → 409;
  - restoring `NEQ` → 409;
  - creating a check with `availability` or a tag list → 422.
- **Behaviour:**
  - readiness writes lock the campaign first (`test_campaign_write_lock.py`);
  - **audit:** exactly one `readiness_applicability_changed` per changed code;
    none — and no row written — for a listed code that changes nothing; none on
    403 or 423;
  - **Follow project** removes the well's row, even after a concurrent untick of
    its field project — the well then doesn't apply;
  - a well ticked under an unticked field project reads the default status, not
    the project's hidden one;
  - re-ticking brings back the status kept underneath;
  - a status PUT, or Reset to project, on a ticked well under an unticked field
    project audits the default (On Track) as the old value, not the project's
    hidden status;
  - the team rows report `applies`, `GET /readiness` keeps its shape; unticked
    cells are left out of the server's `figures` and of the frontend's team
    summaries and badges (each pinned on its own side);
  - migration 038 leaves the Project gates' N/A entries untouched;
  - re-key moves a status and its tick together, and moves neither when the new
    key has either;
  - clone copies applicability rows and skips withdrawn checks;
  - restore keeps a pre-retirement untick;
  - a snapshot records an unticked team check as N/A in
    `readiness_at_submission`, and N/A gates as today;
  - migration 038 round-trips on SQL Server, including data written after the
    upgrade (§4.4).
- **Fixtures:**
  - `_seed_logistics` (`tests/test_readiness_logistics.py`) seeds the six live
    Logistics checks through the admin API. Today it posts `NEQ` with
    `availability` and the 21 equipment tags, which phase 6 refuses.
  - Tests that need `NEQ` as history insert the check (and its entries and tags)
    with the ORM, from migration 036's literals.
  - The equipment and tag-inheritance tests are removed, or rewritten as
    history-render tests.
  - Frontend fixtures (`dev/fixtures.ts`, vitest mocks) drop `NEQ` and the
    equipment.
  - `test_well_inherits_the_project_value_until_it_overrides`
    (`tests/test_readiness_wells.py`) sets the field project's L-BUD to N/A to show
    an override survives. Phase 6 refuses that (422), and `_put` doesn't assert,
    so the test would pass without testing anything: use another status (e.g. On
    Track) and assert 200.
  - `ActivityReadinessPanel.test.tsx` picks N/A from L-BUD's menu: switch it to On
    Track, and assert the menu offers no N/A for team checks.

Phase 7 adds:
- **Effective rule:** a "starts unticked" check reads not selected with no row;
  nominating on a field project writes one `applies = true` row; its wells
  inherit it; un-nominating deletes the row; a well can nominate on its own.
- **Not selected:** carries nothing — not in `figures`, not in
  `readiness_at_submission`, not in "Not applicable" lists. Un-nominating a field
  project returns its following wells to not selected. A well's own untick under
  a nominating field project is N/A.
- **Write path:** ticking a "starts unticked" check on a field project with no row
  writes `applies = true` (no 500); un-nominating deletes it. Audit details read
  "not selected -> applies" and "applies -> not selected".
- **Figures on deploy:** seeding 039 into a campaign with Logistics values changes
  no figure.
- **Catalog:**
  - create with `applies_by_default: false` and `locks_with_plan` → 422;
  - `applies_by_default` isn't editable;
  - a category edit is audited;
  - `catalog_json` carries both fields.
- **Migration 039:** SQLite replay and SQL Server round trip; the downgrade
  retires every active check that starts unticked (the 21 seeded ones and any an
  admin created), and upgrading again restores the ones it retired.
- **Icons:** the backend, React registry and generated paths stay identical; 039's
  seed icon keys are all in `ICON_KEYS`.
- **UI:**
  - the tick list groups, searches (a hidden choice survives a filter) and keeps
    Save in view;
  - the grid folds and unfolds categories with the first column pinned;
  - the chart and print strips draw one icon per category, worst status;
  - tooltips name the types.

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
- **Readiness catalog** (Phase 6):
  - N/A stays a pickable status for the Project gates (checks that lock with the
    plan), drawn grey, as today. Other teams' checks use the tick list instead: N/A
    isn't picked for them, and an unticked one is recorded as N/A in snapshots;
  - `availability` and tag lists are history only;
  - `NEQ` is withdrawn (restore and create refused);
  - applicability rows follow renames (`readiness_rekey.py`) like entries, moving
    as a pair with the status entry;
  - drop "(tags: project ∪ well)" from the inheritance sentence, and add: whether
    a check applies is stored separately from its status and inherits the same
    way — a well follows its field project's tick until it makes its own choice,
    and Follow project removes it;
  - a withdrawn check (history-only status set, or a tag list) is retired and
    can't be restored.
- **Readiness rollups** (Phase 6): an unticked team check isn't counted, exactly
  like N/A; a team where nothing applies draws no icon, while the Project gates
  keep the grey N/A icon; drop "Pending for equipment".
- **Plan-lock lifecycle** (Phase 6): unchanged for the Project gates. The tick
  list is operational, like team statuses: never refused with 423.
- **Plan writes are serialized** (Phase 6): readiness writes (status PUT, reset,
  applicability) take `lock_campaign_writes` too.
- **Governance is auditable** (Phase 6): add `readiness_applicability_changed` and
  the migration's `readiness_applicability_migrated`.
- **Phase 7:**
  - checks have an admin-editable category, and a "starts unticked" setting fixed
    at creation (never on checks that lock with the plan, which also take no
    category);
  - the catalog sentence becomes "A check's team, status set, scope, lock
    behaviour and 'starts unticked' are fixed at creation (only label, icon, order
    and category are editable)";
  - a check that starts unticked and reads its default (no row on the target or
    its field project) carries nothing: not counted, named for a target only in its tick list,
    not in snapshots;
  - the effective "applies?" falls back to the check's default;
  - on the chart and prints a category draws one icon (worst of its types that
    apply);
  - the chart's icon paths are generated from lucide (except the hand-drawn
    `rotary-table`) and kept identical by parity tests.
- **Other docs, same phase:**
  - `docs/user-guide.md` lists five statuses and `CON`, and says approval unlocks
    the plan;
  - `docs/rbac-reference.md` omits team grants;
  - `docs/maintainer-guide.md` still describes the pre-framework gates.

## 11. Resolved decisions (from 2026-10-13)

1. One generic framework with team lenses — not a separate view per team.
2. Two levels: project gates + well gates; a well = project + well + activity type.
3. Logistics checks are **flat** (one status each), not a per-equipment matrix.
4. Nominated Equipment = multi-select of equipment **types**, assignable to a
   project or a well; project equipment is **inherited** by its wells (read-only).
   *(Withdrawn by 30.)*
5. Nominated Equipment status = **Available / Not available**. *(Pending added by
   19; withdrawn by 30.)*
6. **No terrain defaults** in v1.
7. **PC** (Personnel Carrier) is a boat → Vessels.
8. Logistics Budget Availability is **distinct** from project BUD → code **`L-BUD`**.
9. Team grants are **global** (all campaigns); the Wells team owns well gates and
   Logistics owns logistics checks; planners are unchanged and stay per campaign.
   Name a **backup grantee** per team (one focal point = single point of failure).
10. **Project gates lock** with the plan; **well gates and logistics stay live**.
11. **Every logistics check is enabled at project level as well as well level.**
12. **Lenses** (Project gates · Wells · Logistics) keep views uncluttered; an
    **All** view shows everything cleanly (team badges on the chart, collapsible
    team column groups in the grid).
13. **Printing by lens:** the Wells and Logistics teams can print the sequence with
    their own icons; planners can print with project-gate icons only.
14. **Inheritance with override (§3.6):** a project-level status applies to all its
    wells until a well sets its own value; "Reset to project" removes the
    override. Tags combine (project ∪ well). *(Tags withdrawn by 30.)*
15. **Logistics codes confirmed (2026-10-14):** `L-BUD, CTR, NEQ, FFP, CTS, PO, NAV`.
    *(`NEQ` withdrawn by 30.)*
16. **Readiness opt-out hides every team's checks (2026-10-14):** an activity with
    `readiness_required = false` carries no readiness from any team.
17. **Logistics data is visible to everyone (2026-10-14):** no restriction — like
    all readiness, reads are org-wide; only writes need the team grant.
18. **Readiness = what is done (2026-10-16):** the headline is **Complete** (done ÷
    counted); **On track** (Completed or On Track) and **Behind** are shown beside
    it; one definition in every view (§3.7).
19. **Unset means on track (2026-10-16):** a check nobody has set reads its
    default, and every default is on track — On Track, or the new **Pending** for
    equipment (replacing the Not available default). Counted, never done. A
    separate "Not set" state was considered and rejected: planners treat unset as
    on track. *(The equipment default is history only since 30.)*
20. **Opted-out field projects are hidden (2026-10-16)** from the Project gates
    grid and from every figure.
21. **"Starting soon, not ready" uses the Project gates only (2026-10-16).**
22. **The Readiness tab opens on All (2026-10-16);** the dashboard tiles keep their
    12-month default, and links carry the window.
23. **Governed checks belong to the Projects team only (2026-10-16).**
24. **Completed work drops out (2026-10-16):** a field project or well whose
    activities are all completed leaves the Readiness tab and every figure.
25. **No Clear action (2026-10-16):** with unset reading On Track, a wrong status
    is fixed by picking the right one; wells keep "Reset to project".
26. **Rounding (2026-10-16):** percentages round half up, identically on backend
    and frontend.
27. **Each team picks which of its checks apply (2026-10-23):** per field project
    or per well, following the check's level (§3.8); every check starts ticked.
    The Project gates are the exception (31). *(Amended by 36.)*
28. **N/A is no longer a status those teams pick (2026-10-23):** an unticked check
    doesn't apply — no icon, not counted — and is listed muted as "Not applicable"
    only in live tooltips and the Readiness panel (33). *(Narrowed by 37.)*
29. **A team check that applies always shows its status (2026-10-23):**
    Completed, On Track or Behind. A Project gate can still read N/A (31).
30. **Nominated Equipment is withdrawn (2026-10-23):** there is no equipment list,
    and no icon opens a list of options. `NEQ` is retired and its history kept as
    recorded (§3.5). *(Amended by 35.)*
31. **The Project gates stay as they are (2026-10-23):** a gate that doesn't apply
    is set to N/A in its status menu and drawn as the grey N/A icon. Gates are
    frozen with the plan and recorded in revisions, as today. There is no tick
    list for them.
32. **No reason is asked for an untick (2026-10-23):** it would add friction.
33. **Approvers don't need a list of excluded checks (2026-10-23):** no
    revision-page listing, no Compare change for them, and no `readiness_required`
    diff in phase 6.
34. **Ticks are stored separately from status (2026-10-23):** in
    `readiness_applicability` (§4.4), not as an N/A status. Re-ticking restores the
    status kept underneath, and a well keeps following its field project's status
    while making its own choice about whether a check applies (§3.8).
35. **Equipment types become Logistics checks (2026-10-24):** one check per type,
    the 21 types of §3.5, under the Logistics team, enabled at both levels, with
    the standard status set (§3.9). This amends decision 30: the equipment types
    return as ordinary checks; `NEQ`, its tag list and the rule that no icon opens
    a list of options stay as decided.
36. **Equipment checks start unticked (2026-10-24):** ticking a type nominates it.
    "Starts unticked" is a per-check setting fixed at creation. This amends
    decision 27: every check starts ticked unless it is created "starts unticked".
37. **Not selected carries nothing (2026-10-24):** a check that starts unticked and
    reads its default (no row on the target or its field project) has no icon,
    draws a blank grid cell, isn't counted and is named for a target only in its tick list.
    Only a check that doesn't apply because of a row (the target's own untick or
    its field project's) reads "Not applicable". This narrows decision 28.
38. **Plain codes (2026-10-24):** `RW`, `DSV`, … `NNRA`, with no prefix.
39. **Categories, and status words unchanged (2026-10-24):** checks get an
    admin-editable category that groups the tick list (with search; no
    pagination), the grid (folded columns), the panel and the legend. On the chart
    and prints a category draws one icon, the worst of its types that apply.
    Equipment uses Completed / On Track / Behind.
40. **More icons (2026-10-24):** the owned icon registry grows to 68; every new key
    comes from lucide. The icon picker gets search and groups (§8.5).
41. **No carry-over (2026-10-24):** production runs Project readiness only, so it
    has no readiness catalog and no Nominated Equipment data. The first deploy
    runs, in order, every migration after production's current revision, through
    039 (034–039 if production is at 033); check with `alembic current` before
    deploying. Wherever 036 has run, 038 still retires `NEQ` and keeps its
    history.
42. **A team grid shows one view at a time (2026-10-25):** Projects (default) or
    Wells, and the count, summary, banners and window follow the view (§8.8).
43. **Team tiles count field projects (2026-10-25)**, for consistency with the
    Project gates — reversing "a team with well-level checks counts wells"
    (2026-10-16). A field project folds in its in-scope wells: for a well-level
    check, the worst of its wells (done only when done on every well that needs
    it, behind when any is behind); a project-only check reads the project's own
    value. Chosen over counting the project's own values only, which would hide a
    well that is behind on its own. A well with no field project is on no tile.
    The Projects view carries the same figures per window, so tile and tab agree.
    A team whose checks are all well-level keeps counting wells — it has no
    Projects view to agree with.

## 12. Open questions

1. **Well-gate list** — names and status set for each (location preparation,
   permits, …). Left blank; added via the catalog, no code change needed.
2. **Known risk, outside phase 6:** SQL Server compares names case-insensitively
   by default.
   - **Writes are covered by phase 6.** The status PUT, Reset to project and the
     tick write find the target's own row with the database's comparison, so
     "Bonga Phase 3" and "BONGA PHASE 3" no longer collide on the unique key
     (`tests/test_readiness_ci_collation.py` simulates the collation).
   - **Still open:**
     - reads still group by exact case, so such names show as two rows that the
       database treats as one target;
     - a case-only field-project rename can strand that project's readiness: the
       re-key sees the old name as still in use.

     Both need their own fix and a real SQL Server test.
3. **"Equipment confirmed" (phase 7)** — with equipment starting unticked, "needs
   no equipment" and "nobody has listed it yet" look the same. *Recommended:* one
   core Logistics check, e.g. `EQC` "Equipment confirmed", that reads On Track
   until the coordinator confirms the list. Not decided.

## 13. Future ideas (not decided)

- Catalog rules for which team checks apply (e.g. NAV only off LAND), so the tick
  list (§3.8) only handles exceptions. This replaces the earlier "terrain
  defaults" idea.
- Audit feed paging: the feed shows only the newest 100 events (§5.3).
- Moving the Project gates onto the tick list, if the grey N/A icons ever feel
  like clutter. Phase 6 deliberately leaves them out (decision 31). It would need
  applicability rows for checks that lock with the plan, the plan lock (423) on
  ticks, and ticks recorded in revisions and Compare.
- An optional reason when a check is unticked (dropped for now, decision 32).
- Showing approvers what didn't apply, and diffing `readiness_required`, in
  Compare (dropped for now, decision 33).
- Named equipment units in the resource registry, with contract and FFP-inspection
  expiry dates driving `CTR` / `FFP` automatically — like "contracts at risk".
- Need-by offsets ("PO due 30 days before spud") that auto-flag `blocked`.
- Notifications to a team when its checks turn `blocked` inside the focus window.
