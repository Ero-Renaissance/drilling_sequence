# Well Execution Readiness — draft spec (readiness phase 8)

**Status:** decisions D1–D7 agreed 2026-11-23 (§5). **Part A is built**
(migration 040, PR 33). **Part B is built** (`WellExecutionGrid.tsx`, branch
`feat/well-execution-readiness-page`), with two additions it needed: each well
row carries its value stream (`market`), and a status write that sends no
`notes` keeps the cell's note (`notes: null` clears it).
**Source:** the "Well Execution Readiness" sheet (Value Stream · Project · Wells ·
Spud date · eight checks, coloured cells) and the decision that the Project gates
are really per-well readiness checks.
**Extends:** `docs/readiness-framework-spec.md`. Once agreed, the rule changes
below are folded into that document and `CLAUDE.md`.

## 1. What changes, in one paragraph

Today the seven "Project gates" are set once per field project and every well in
it shares them. After this change they are **well execution readiness checks**:
each well has all of them, a well follows its field project's value until it is
given its own, and the page looks like the sheet — one row per well, grouped by
value stream and project, one solid coloured cell per check. The check list is
updated to the sheet's eight, and a fourth status, **Not started**, is added.

## 2. Two parts, two pull requests

| | Part A — the checks | Part B — the page |
|---|---|---|
| What | Per-well values, the new check list, the Not started status | The sheet-style page |
| Touches | Catalog, one migration, rollup, snapshot, revision diff, rules in `CLAUDE.md` | Frontend only (plus at most one read field) |
| Risk | High: changes governed data and what revisions record | Low: presentation |
| Usable alone | Yes — the existing Wells view becomes truly per-well | No — needs Part A's per-well values |

**Recommendation:** one spec (this document), two PRs, Part A first. Part A is
the one IT security review should read closely; keeping the page out of it keeps
that diff small.

---

## Part A — the checks

### A1. Names (UI copy only)

- The lens "Project gates" becomes **"Well Execution Readiness"**. "Gate"
  becomes "check" in user-facing copy.
- Every team lens follows the same pattern: **"<Team> Execution Readiness"** —
  "Logistics Execution Readiness", and so on. This is the lens label only; the
  team's own name ("Logistics") is unchanged in the catalog, the Admin page, the
  grants and the audit trail. On narrow screens the lens picker may shorten the
  label to the team name, with the full name as its title.
- Code and database keep `projects` (team code), `locks_with_plan`,
  `project_gate_checks`, and so on — the same precedent as Campaign / `Project`
  and Endorse / `review`. No stored value is renamed.

### A2. The check list

Codes are immutable and never reused, so existing checks are **relabelled and
reordered**, not replaced. One check is new.

| Order | Sheet column | Code | Today's label | Change |
|---|---|---|---|---|
| 1 | Approved FDP/IP | `FDP` | Field Development Plan | relabel |
| 2 | FID | `FID` | Final Inv. Decision | relabel to "Final Investment Decision", reorder |
| 3 | Budget Supported by Partners | `BUD` | Budget | relabel, reorder |
| 4 | Well Proposal | `FE` | Wells Front End | relabel (same check — D1) |
| 5 | EIA/Waiver | `EIA` | Env. Assessment | relabel |
| 6 | LLI | `LLI` | Long Lead Items | reorder (label unchanged) |
| 7 | Location Readiness | `LOC` | Location | relabel, reorder |
| 8 | Well Permits | `WP` (new) | — | **new check** |

- FID and LLI are headed by their codes on the sheet. Every view already shows
  the code beside the label, so they keep a spelled-out label (a label equal to
  its code would read "FID FID"); Part B's column headers can use the code.
- Existing values stay attached to their codes; nothing is lost.
- Approved and pending revisions keep their frozen catalogs (`catalog_json`), so
  they still show seven checks under the old labels. Only new revisions record
  eight.
- `WP` takes an icon from the owned `ICON_KEYS` registry (no upload). The code
  `WP` must be checked against existing and reserved codes before the migration.

### A3. Each well has every check

- All eight checks are enabled at **both levels**: field project and well.
- A well **follows its field project** until someone sets the well's own value;
  **Reset to project** removes the well's value. This is the inheritance the
  team checks (Logistics…) already use — no new mechanism.
- A well with no field project has only its own values (default until set).
- Rules this reverses (to be rewritten in `CLAUDE.md` and the framework spec):
  - "a check that locks with the plan is enabled at project level only";
  - "a check's scope is fixed at creation" — it stays fixed for admins; the
    migration flips it once for these checks, as migrations 038/039 did for
    theirs.
- Unchanged: only planners (and admins) edit them; they are still the governed
  checks recorded in the revision snapshot's gate block and compared in the
  revision diff; they stay editable while the plan is locked (2026-11-23).

### A4. Statuses

The sheet has four statuses. Its grey cells mean nothing (stray colouring in the
sheet) — they are not a status.

| Sheet | Stored status | Severity | Counts as |
|---|---|---|---|
| Completed / In place | `Completed` | `done` | done |
| On track / Progressing | `On Track` | `in_progress` | on track |
| Behind schedule | `Behind` | `blocked` | behind |
| Not started (X) | `Not started` (**new**) | `not_started` (**new**) | counted; not done, not on track, not behind |
| (not on the sheet) | `N/A` | `not_counted` | not counted |

- Stored status text does not change for the three existing statuses; the legend
  shows the sheet's wording.
- **Not started** needs a new severity, because none of the four existing ones
  means "counted but not yet moving". Rollup effect (one definition,
  `readiness_rollup.py`):
  - Complete = done ÷ counted — unchanged;
  - On track = (done + in progress) ÷ counted — a not-started cell lowers it;
  - Behind = blocked cells — unchanged;
  - worst-of order when a project reads its wells:
    `blocked` > `not_started` > `in_progress` > `done`.
- These checks move to a **new status set** (working name `execution`) holding
  the five statuses above. The `standard` set is left alone, so Logistics and
  other teams are unaffected.
- **N/A stays** for these checks (agreed earlier), for a check that genuinely
  doesn't apply to a well. The sheet doesn't use it; it is drawn grey. Moving
  these checks to the teams' tick list is a later step, not this one.
- **An unset check reads Not started** (D2): `execution`'s default is
  `Not started`. The rule "every default is on track" becomes "every default is
  on track, except the `execution` set, whose default is Not started".
  Consequences, all intended:
  - on the day of the migration, existing campaigns' On track figures drop for
    every check nobody has set (they read On Track until then);
  - a field project whose wells are all unset reads Not started;
  - approved and pending revisions don't change — they recorded values, not
    defaults;
  - Complete and Behind are unaffected.
- **Not started is not offered to Logistics or any other team** (D4): only the
  `execution` set has it.

### A5. A short note in the cell

The sheet carries text in cells ("10k", "???"). Readiness entries already have a
`notes` field, saved and audited with the status. Part A changes nothing here;
Part B shows the note in the cell and lets it be edited. The existing length
bound applies and the text is rendered through React's escaping only.

### A6. Rollups, tiles and warnings

- A field project's figure for a check is the **worst of its wells in scope**
  (`fold_project_cells`), exactly as the team tiles already work. A project with
  no well in scope reads its own value.
- The Overview tile keeps counting field projects.
- "Starting soon, not ready" reads each well's effective value instead of its
  project's.
- Nothing counted still reads "—", never 0%.

### A7. Revisions

- The snapshot already stores check values **per activity**; each activity now
  records its well's effective value instead of its project's.
- The revision diff reports a changed check per well.
- Past revisions are untouched and render from their own frozen catalogs.

### A8. Migration (040 — data only, lossy downgrade)

1. The `execution` status set and the `not_started` severity are code-defined.
2. Every check that locks with the plan moves to `execution` and is enabled at
   well level; the seven built-in ones are relabelled and reordered.
3. `WP` is inserted only where the code is absent.
4. Each catalog change writes one `readiness_check_updated` /
   `readiness_check_created` catalog event (no user, "migration 040"). No
   per-campaign row: no campaign data is rewritten.
5. No existing status row is rewritten. Unset checks read Not started from this
   migration on (A4), so live figures change that day; approved snapshots do
   not.

Must pass the SQL Server CI job (`alembic upgrade head` + `alembic check`).

### A9. API, authorization, audit

- No new endpoint. The status PUT and reset already accept `scope: "well"`; they
  now accept it for these checks.
- `GET /readiness` (the per-field-project read) keeps its shape — each field
  project's OWN values — with figures folded over its wells; the app itself now
  reads these checks through `GET /readiness/teams/projects`, like any team.
- A new check that locks with the plan must be enabled at both levels and use
  the `execution` set; no other check may use it (422).
- Authorization unchanged: `assert_can_edit_check` (planner for this team,
  admin bypass), then `lock_campaign_writes`, target scoped to the campaign.
- Audit unchanged: `readiness_updated` and `readiness_reset` per real change.
- A well rename moves its values with it (`readiness_rekey`, already handles
  well-level entries).

### A10. Tests (Part A)

- A well inherits, overrides, resets; a well with no field project.
- Denial: a non-planner cannot write a well-level value (403); a well of another
  campaign is 404.
- `Not started` in every rollup figure and in worst-of folding.
- Snapshot records per-well values; an old revision still renders seven checks.
- Migration up/down on PostgreSQL, SQLite and SQL Server.
- Frontend/back-end parity tests for the status set and severities.

---

## Part B — the page

### B1. Layout (from the sheet)

```
Value stream | Project      | Well          | Spud 2027 | 2028 | FDP/IP | FID | Budget | Well Prop. | EIA | LLI | Location | Permits
Oil          | SSAGS3 Swamp | OGBO ADTU-1   | Jan       |      |  red   | grn | grn    | grn        | grn | grn | grn      | amber
             |              | OGBO BATP-1   | Apr       |      |  10k   | grn | ...
             | SSAGS3 Land  | ANGA KDHU-    |           | Jan  | ...
Oil          | Workover     | Forc151       | Jan       |      | (grey) | ...
```

- **Rows:** one per well, grouped by value stream, then project. The group cells
  span their wells, as in the sheet.
- **Value stream:** the activity's existing `market` field (D3) (Oil / Domestic
  Gas / Export Gas / Not Applicable). No new field.
- **Spud date:** the well's start date, shown as the month under its year
  column. Year columns cover the selected window.
- **Check cells:** a solid coloured cell per check — green, amber, red; **X** on
  white for Not started. N/A (not on the sheet) is grey with a dash. A legend
  sits under the table, as in the sheet.
- **Colour is not the only signal:** each cell also carries its status in the
  tooltip and an accessible label, and Not started / N/A have a distinct mark,
  so the page works for colour-blind users and in greyscale print.
- **Note:** shown as short text in the cell, with a corner marker when it is
  longer than fits.

### B2. Editing

- Click a cell: pick a status, edit the note, or **Reset to project**.
- A value the well inherits and a value of its own look the same colour; a small
  marker shows "set on this well".
- The project cell has **"Set for all wells in this project"** — it sets the
  field project's value, which every well without its own value follows.
- View-only for non-planners, with the existing explanation line.

### B3. What stays, what goes

- Stays: the window, the search, the Complete / On track / Behind summary, the
  "Plan locked · readiness stays editable" chip.
- New: a value-stream filter.
- **Goes: the Projects | Wells switch on this page** (added 2026-11-23). The
  grouped table shows both levels at once, so the switch is no longer needed
  here. The team grids (Logistics…) keep theirs.
- Unchanged in this phase: the team grids, the All view, the chart icons and the
  print-outs. Whether Logistics should adopt the same layout is a later question.

### B4. Tests (Part B)

- Grouping and spans; year columns follow the window.
- Each status renders with its mark and label; the note shows.
- Editing a well cell writes `scope: "well"`; the project action writes
  `scope: "project"`; Reset to project.
- Read-only for a non-planner.

---

## 5. Decisions (agreed 2026-11-23)

| # | Question | Decision |
|---|---|---|
| D1 | Is "Well Proposal" today's "Wells Front End" (`FE`)? | Yes — relabel `FE`. |
| D2 | What does an unset check read? | **Not started.** |
| D3 | Is Value Stream the existing Market field? | Yes — no new field. |
| D4 | Offer "Not started" to Logistics and other teams? | No. |
| D5 | Lens name | "Well Execution Readiness"; other teams read "<Team> Execution Readiness". |
| D6 | Code for Well Permits | `WP`. |
| D7 | The sheet's grey cells | Mean nothing — not a status. N/A stays available, drawn grey. |

## 6. Out of scope

- Moving these checks from N/A to the teams' tick list.
- Redesigning the Logistics grid, the All view, the chart or the print-outs.
- Excel export of this page.
- Renaming anything in code or the database.
