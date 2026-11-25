# Equipment quantity and one page layout for every team

**Status:** AGREED 2026-11-25. Decisions are in §4; nothing is open. **§2 (the
layout) is built** — `ReadinessSheet.tsx`, plus one change to the team read
(below). §3 (quantity) is not.
**Source:** two requests — (1) every team's readiness page uses the sheet layout
of Well Execution Readiness; (2) for equipment (Aviation, Vessels, Barges, Land
transport, Lifting) there is a way to say **how many** of an item are needed.
**Builds on:** `docs/well-execution-readiness-spec.md` (the layout) and
`docs/readiness-framework-spec.md` §3.9 (equipment checks and categories).

## 1. What we have today

- Logistics has 6 checks with no category (budget, contract, purchase order…)
  and 21 equipment types in 6 categories: Aviation, Vessels, Barges, Land
  transport, Lifting, Permits.
- An equipment type "starts unticked": it applies to a field project or well
  only once someone selects it. Each selected type then has a status — On
  Track, Behind or Completed.
- Nothing records **how many** of a type are needed.

## 2. One layout for every team

Every team's page uses the Well Execution Readiness sheet:

- one row per well, grouped by value stream and field project; the spud month
  under its year; the year picker (1–3 years);
- one solid coloured cell per check; notes in the cell; a cell menu to edit;
  "Set for all wells" on the project cell; the key underneath.

What the other teams need on top:

| Difference | How the layout handles it |
|---|---|
| Many more checks (Logistics: 6 + 21) | A check without a category is an ordinary column. Each category is ONE column showing the worst of its selected types; clicking its header unfolds the types. As today. |
| A check can be switched off for a well or project | Blank cell = not selected; dashed cell = not applicable. The "Checks…" picker stays, on the well and on the project cell. |
| Different statuses | Three colours only: no Not started, no N/A. |
| Different editors | Holders of the team's grant, not planners. |
| A check enabled at project level only | Drawn ONCE, as a cell merged across the field project's wells. A well with no field project shows it blank. |
| A check enabled at well level only | A cell per well; nothing on the project cell. |

Wording: the checks without a category are **not** called "core". They come
first as ordinary columns with no group heading; the categories follow with
theirs.

The Projects | Wells switch goes away on these pages, as it did for Well
Execution Readiness: the grouped table shows both levels.

As built: the page's summary adds up the wells shown, so it reads wells where
the team's Overview tile reads field projects. The Wells column stays pinned
while the sheet scrolls sideways. Links carry no `?view=` any more.

One backend change came with it: the team read returns well rows for EVERY
team. A team whose checks are all project-level used to get none (it had only
the Projects view); now each of its wells under a field project has a row
reading that project's values, so its page is not empty. A well with no field
project carries nothing from such a team and has no row.

## 3. Quantity needed

### 3.1 The rule

- A check can be set to **take a quantity**. It is a setting on the check (a
  category is only a text label on a check, not something an admin creates):
  - set in the admin form when a check is created — pre-ticked when the other
    checks of its category take one;
  - **editable afterwards**, audited (`readiness_check_updated`); switching it
    off hides the numbers and keeps them;
  - never on a Well Execution Readiness check (422), like a category;
  - switched on by migration for the checks in Aviation, Vessels, Barges, Land
    transport and Lifting. Not Permits.
- The quantity is **per type**: a whole number, **1 or more**. Zero is not a
  quantity — deselect the type instead.
- **Blank by default.** Selecting a type states no number; the cell shows one
  only once someone enters it. Nothing already selected is stamped "×1".
- **Where it is set:** on the field project or on a well, beside the tick in
  the "Checks…" picker.
- **What a project's number means:** the need of the **whole field project**.
  A well shows its project's number until it is given its own ("Reset to
  project" drops the well's). The app **never adds wells together** — there is
  no campaign-wide total.
- **Shown:** in the cell and the picker ("PSV ×2"); a folded category shows the
  total of its selected types on that row ("Vessels · 3"). On the Readiness
  page, the picker and the well dialog only — not on the sequence chart or the
  print-outs.
- **Figures are unchanged.** A type counts once in Complete / On track /
  Behind, whatever its number.
- **Needed only.** "Secured" (showing "2 of 3") is a later step: it overlaps
  with the status and needs one rule tying the two.

### 3.2 What it takes

- **Database:** a boolean on `readiness_checks` (takes a quantity), and a table
  of quantities keyed by NAMES like the status entries (campaign + check + field
  project [+ well + activity type]). Its own table, not a column on
  `readiness_applicability`: an applicability row is deleted when a choice
  equals the check's default or a well goes back to following its project, and
  the number must survive deselecting. One migration, with the flag set for the
  five categories; SQL Server and PostgreSQL.
- **Validation:** whole number 1–999 (Pydantic); the check must be active, of
  the team, and take a quantity (422); the check must apply to the target (409,
  as a status write).
- **Who edits:** unchanged — `assert_can_edit_check` (the team's grant holders
  and admins), then `lock_campaign_writes`.
- **Audit:** each real change writes a governance event, old → new
  (`readiness_quantity_changed`).
- **Renames:** the number moves with the status entry and the applicability row
  when a well, field project or activity type is renamed
  (`readiness_rekey.py`), and does not move if the new name already has any of
  the three.
- **Plan lock:** not frozen, like every readiness value.
- **Revisions:** the number at submission is recorded in
  `readiness_at_submission`. Like every non-governed check it is not compared
  between revisions, so a change from 2 to 3 does not show in the diff.
- **API:** the team read returns the effective number with each cell and whether
  it is the target's own; one write sets or clears it.

## 4. Decisions (2026-11-25)

| # | Question | Decision |
|---|---|---|
| Q1 | Quantity per type or per category? | Per type; the category shows the row's total. |
| Q2 | Which checks take a quantity? | Aviation, Vessels, Barges, Land transport, Lifting; an admin sets it per check. |
| Q3 | What does a project's number mean? | The whole field project's need; a well may hold its own; wells are never added together. |
| Q4 | Needed only, or needed and secured? | Needed only for now. |
| Q5 | Does quantity change the figures? | No. |
| Q6 | A heading for the checks without a category? | None; never "core". |
| Q7 | The layout for Logistics only, or every team? | Every team. |
| Q8 | Default when a type is selected? | Blank; minimum 1. |
| Q9 | Can "takes a quantity" change after creation? | Yes, audited; numbers are kept. |

## 5. Order

1. The sheet layout for every team — one PR (built).
2. Quantity needed (database, admin form, API, audit, page) — a second PR.
