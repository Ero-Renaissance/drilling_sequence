# Drilling Sequence — User Guide

Welcome! **Drilling Sequence** is Renaissance Africa Energy's tool for planning the
drilling/rig schedule and getting it **formally approved**. This guide gets a brand-
new user productive in a few minutes. No technical knowledge needed.

---

## 1. What this app is for

It does three things:
1. **Plan** the schedule — which rig drills which well, where (land / swamp /
   offshore), and when, shown as a visual timeline (a Gantt chart).
2. **Track readiness** — for each activity, are the prerequisites (budget, permits,
   contracts, etc.) ready?
3. **Approve** — submit a version of the plan, route it to the designated approvers,
   and capture their formal sign-off with a full audit trail.

Think of it as "the official, sign-able rig schedule," not a scratchpad.

---

## 2. Signing in

1. From a Renaissance computer where you're logged in with your Windows account,
   open the app link your IT team gave you (e.g.
   `https://drilling.renaissanceafrica.com`).
2. You're signed in **automatically** with your Windows account — there's no button
   to click and no separate password to remember.
3. You'll land on the **Dashboard**.

If you can't sign in or can't see a project you expect, contact your project's
planner or an admin — access is granted per project (see Roles below).

---

## 3. Roles — who can do what

Roles are set **per project**. One person can be a planner on one project and a
viewer on another.

| Role | Can do |
|---|---|
| **Viewer / Reviewer / Approver (member roles)** | Read everything: the schedule, readiness, history. These roles control editing/visibility only — none of them, on their own, lets you sign. |
| **Planner** | The schedule owner: create/edit activities, set the Project gates and contracts, designate reviewers/approvers, set the review policy, submit for approval, clone the project. |
| **Admin** (global) | Application-wide administration; can act across all projects. Managed on the **Admin** page. |

**Readiness team grants** are separate from the roles above. An admin can give you
the grant for one readiness team (e.g. **Wells** or **Logistics**) on the **Admin**
page; it lets you update that team's readiness checks in **every** campaign, and
nothing else — no schedule edits, no Project gates, no signing.

**Who actually signs** is set separately, by **email**, on the project's **Approvals**
settings — independent of the roles above (signers may even be people outside the
project):

- **Designated reviewers** sign off the optional *review* stage.
- **Designated approvers** give the binding *approval*.

> **You can't sign off your own plan.** Whoever submits a revision cannot review or
> approve it — only someone else on the matrix (or an admin) can.

---

## 4. Getting around

- **Sidebar (left):** **Dashboard** (overview), **Projects** (your projects),
  **Admin** (admins only), **Settings**.
- Open a project and you'll see six tabs across the top:

| Tab | What it's for |
|---|---|
| **Sequence** | The visual timeline (Gantt chart) — the main view. |
| **Activities** | The data behind the chart, as an editable table. |
| **Readiness** | The readiness checks for each activity. |
| **Compare** | See what changed between versions (or vs. another project). |
| **Approvals** | Submit for approval and see sign-off status. |
| **Activity Log** | The audit trail — who did what, when. |

- Top-right: a **dark/light mode** toggle and your account.

---

## 5. The Sequence chart (reading the timeline)

Each **row** is a rig in a location, e.g. *OFFSHORE – Offshore Rig 2*. Each
**coloured bar** is an activity (a well/job) on that rig, positioned by its start
and end dates. The colour tells you the **activity type** (see the legend at the
bottom — e.g. red = Oil Development, green = Gas Development).

Things to look for:
- **Dashed red "Today" line** — where we are now in time.
- **Red outline around a bar** — a **rig conflict**: two non-completed activities on
  the *same rig* whose dates overlap. A rig can only be in one place at a time, so
  this is physically impossible and must be fixed (see §8).
- **Small icons under a bar** — the readiness checks for that activity, at a glance.
  The lens picker chooses which team's icons you see (see §7); a Wells or
  Logistics check that doesn't apply to the activity has no icon.
- **A small alarm-clock next to a rig name** — that rig's contract is expiring; the
  colour shows how urgent (green = healthy → red = expired).
- **Focus year buttons** (above the chart: `All 2026 2027 …`) — click a year to zoom
  the timeline to just that year; click **All** to zoom back out. You can also click
  a year label on the time axis.
- You can **export** the chart (PDF/print) for reports.

---

## 6. Building the schedule (planners)

### Create a project
**Projects → New project** (planners). Give it a name, field, and region.

### Add activities — two ways
- **Manually:** on the **Activities** tab, add a row and fill in: activity type,
  start/end dates, well, rig, location (LAND/SWAMP/OFFSHORE), plan type, risk.
- **Import:** **Import CSV / Excel** to bring in many activities at once. The file is
  validated on upload — bad rows are rejected with a message, and a rejected import
  never wipes your existing data.

### CSV / Excel import format
Use **Import CSV / Excel** to bulk-load activities. In the import dialog, click
**Download a blank template** to get a starter file with the right columns and a few
example rows — fill it in and upload it.

**Required columns** (the import is rejected if any are missing):

| Column | Notes |
|---|---|
| `Activity Type` | e.g. *Oil Development*, *Gas Appraisal*, *Water Injection*. |
| `Start Date` | A real date — `YYYY-MM-DD` is safest (e.g. `2026-01-15`). |
| `End Date` | Must be on or after Start Date. |

**Optional columns** (filled in if present, otherwise left blank):

| Column | Allowed values |
|---|---|
| `Well Name` | free text (the well/job name shown on the bar). |
| `Rig Name` | free text (the rig — drives the timeline rows and conflict checks). |
| `Location` | `LAND`, `SWAMP`, or `OFFSHORE`. |
| `Plan Type` | `Firm`, `Option`, or `Out of Plan`. |
| `Risk` | `Low`, `Medium`, or `High`. |
| `Comment` | free text. |

Tips:
- **Readiness isn't set here.** Set readiness — the Project gates
  (FDP/LLI/LOC/FE/FID/EIA/BUD) and the Wells and Logistics checks — on the
  **Readiness** tab (see §7); that's what shows on the chart. The importer only
  creates activities.
- **Rig contracts aren't set here either.** A rig has one contract per project — set
  its **start and end dates** (and status) on the **Contracts** tab, which drives the
  contract-expiry indicators on the chart.
- A few **column aliases** are accepted (e.g. `Well Name` ↔ `Item Name`/`Name`;
  `Rig Name` ↔ `Resource`/`Equipment`/`Contractor`), but the names above are the
  canonical ones.
- **Extra/unknown columns are ignored**, so it's safe to import a richer sheet.
- The file is **validated on upload** — bad rows are rejected with a message, and a
  rejected import **never wipes** your existing activities.

### Mark progress
When an activity is finished, mark it **complete**. Completed activities "release"
the rig (they no longer count toward rig conflicts) and are dropped when you clone
the project for the next quarter.

---

## 7. Readiness checks

Readiness checks belong to **teams**. A **lens** picker — on the Readiness tab, the
chart and the prints — chooses whose checks you see: **Project gates**,
**Logistics**, any other team an admin has added (e.g. **Wells**), or **All**. It
opens on your own team, but anyone can switch to any lens.

| Team | Who sets it | Set per | Frozen when the plan is submitted? |
|---|---|---|---|
| **Project gates** | The campaign's planners | Field project (shared by its wells) | **Yes** — and it stays frozen once approved |
| **Logistics** | Holders of the Logistics team grant | Field project; a well can override it | No — always editable |
| **Wells** (and future teams) | Holders of that team's grant | Well (or as an admin sets it up) | No — always editable |

Admins can update any team's checks.

### Statuses

Every check shows one of:
- **On Track** (amber) — the default: nobody has reported a problem.
- **Completed** (green) — done.
- **Behind** (red) — something is holding it up.
- **N/A** (grey) — **Project gates only**: the gate doesn't apply to that field
  project. It isn't counted.

Readiness is summarised in three figures, e.g. **"50% complete · 83% on track · 1
behind"**: *complete* counts only what's Completed, *on track* adds what's On
Track, and *behind* is the number of checks marked Behind. Where nothing counts, the
figures read "—".

### The Project gates

| Code | Meaning |
|---|---|
| **FDP** | Field Development Plan |
| **LLI** | Long Lead Items |
| **LOC** | Location |
| **FE** | Wells Front End |
| **FID** | Final Investment Decision |
| **EIA** | Environmental Assessment |
| **BUD** | Budget |

The old **CON** (Contract) gate has been retired: a rig's contract shows as the
alarm clock next to the rig name on the chart instead.

### Logistics checks

| Code | Meaning |
|---|---|
| **L-BUD** | Budget Availability |
| **CTR** | Contract Availability |
| **FFP** | Assurance / FFP Inspection |
| **CTS** | Community Trust and Support |
| **PO** | Purchase Order |
| **NAV** | Naval Clearance |

A Logistics status set on a field project applies to all its wells (shown greyed
"from project") until a well sets its own; **Reset to project** puts the well back.
Nominated Equipment (NEQ) has been withdrawn; past revisions still show it as
recorded.

### Checks that apply (Wells, Logistics and other teams)

Not every check matters everywhere — Naval Clearance means nothing for a land well.
In the Wells and Logistics grids, each field-project and well row has a **Checks…**
button (an activity's Readiness panel has one per team too). It lists the team's
checks, **all ticked by default**: untick the ones that don't apply and **Save**.

- An unticked check has **no icon** on the chart or in prints, shows **"—"** in the
  grid ("Not applicable"), and isn't counted in any figure.
- Its status is kept: tick it again and it comes back as it was. To change its
  status, tick it first.
- A well follows its field project's ticks ("from project") until you make a
  different choice on the well ("set on this well"); **Follow project** undoes it.
- Ticks stay editable at any time, even while the plan is locked. No reason is
  asked for an untick.

The Project gates have no tick list: a gate that doesn't apply is set to **N/A**,
as before.

The statuses also show as the little icons under each bar on the chart, so anyone
can see at a glance what's holding an activity back.

---

## 8. Rig conflicts (important)

A rig is one physical asset — it can move between land, swamp, and offshore over
time, but it **cannot run two activities at once**. If two non-completed activities
on the same rig overlap in time, the app flags it:

- On the chart, the conflicting bars get a **solid red outline**.
- When you try to **submit for approval**, the app **blocks** it and tells you which
  rig is double-booked and by how many days.

**To fix:** move one activity's dates, reassign it to a different rig, or mark the
earlier one complete. Then submit again.

---

## 9. The approval workflow (the heart of the app)

This is how a plan becomes "official."

```
 Planner edits the plan
        │
        ▼
 Designate reviewers + approvers,   ──►  Submit  ──►  a "revision" (snapshot) is created
 set the Review policy (Approvals tab)               and the plan is LOCKED from edits
        │
        ▼
 Optional REVIEW stage  (only if the revision was routed through review)
        │
        ├─ all designated reviewers sign off          ──►  goes to approval
        └─ a reviewer Requests changes (with reason)  ──►  sent back for edits ✏️
        │
        ▼
 APPROVAL stage — each approver signs
        │
        ├─ all designated approvers signed (and there's ≥1)  ──►  APPROVED ✅ (plan stays locked)
        ├─ an approver Rejects (with a reason)               ──►  REJECTED ⛔ (final)
        └─ an approver Requests changes (with a reason)      ──►  sent back for edits ✏️
```

**Review policy** (set per project, on Approvals):
- **Required** — every revision goes through review first.
- **Optional** (default) — when you submit, you choose "Send for review
  first" or "Submit straight to approval." Skipping review tags the revision
  **"Review skipped"** so approvers can see it was bypassed.
- **Off** — review is unavailable; revisions go straight to approval.

Key rules to know:
- **Submitting locks the plan.** While a revision is open (in review *or* awaiting
  approval), the activities, the Project gates and the contracts are frozen so
  signers see a stable snapshot. (Editing a locked item is refused.) Wells and
  Logistics readiness — statuses and ticks — stay editable: the revision records
  them "as at submission" for reference.
- **Approval keeps the plan locked.** The approved version is the official record,
  so the live plan can't drift from it. To change an approved plan, a planner clicks
  **Revise Plan** on the lock banner; the changes then go through approval again.
- **All designated reviewers must sign** for a revision to leave the review stage;
  **all designated approvers** must sign (and there must be ≥1) for it to be approved.
- **Reviewers can bounce, not kill.** A reviewer can **Request changes** but cannot
  reject — the final **Reject** belongs to approvers.
- **You can't sign off your own plan** (separation of duties). If you submitted it,
  someone else must review/approve it; you can only discard it.
- **Both "decline" outcomes need a reason** (1–2000 characters); either way (or if
  the revision is discarded) the plan unlocks so the planner can revise and
  resubmit.
- **Everything is logged.** Submit, review sign-off, sign, approve, reject, discard,
  Revise Plan, reviewer/approver add/remove, review-policy changes, project
  create/clone, readiness changes (statuses and which checks apply) — all captured
  on the **Activity Log**.

You'll be notified (by email, if configured) when a plan needs your **review** or your
**signature**. Open the project → **Approvals** → review the changes → sign off / request
changes / (approvers) reject.

---

## 10. Comparing versions

The **Compare** tab shows what changed:
- between the **current plan and the last approved version** (what's changed since
  approval), or
- between this project and **another project** (e.g. last quarter's schedule),
  matching the same logical activities so you can see moved dates, changed rigs,
  added/removed wells, and contract changes.

Unchanged rows are collapsed by default so the **changes** stand out.

---

## 11. Rolling over to the next period

When it's time for the next quarter's plan, a planner can **clone** the project. The
clone:
- copies the activities and rig contracts,
- **drops completed activities** (that work is done),
- keeps a link back to the source so **Compare** can line up the same activities
  across quarters.

You then adjust the clone and run it through the approval workflow again.

---

## 12. Glossary

- **Activity** — one scheduled job (a well/operation) with a rig, dates, and type.
- **Revision** — a submitted *snapshot* of the plan that goes through approval.
- **Rig conflict** — same rig, overlapping non-completed activities. Blocked at
  submission.
- **Terrain / Location** — `LAND`, `SWAMP`, or `OFFSHORE`.
- **Plan type** — `Firm` (committed), `Option` (possible), `Out of Plan` (not in the
  baseline).
- **Risk** — `Low`, `Medium`, `High`.
- **Readiness statuses** — `On Track` (the default), `Completed`, `Behind`; the
  Project gates also use `N/A`.
- **Not applicable** — a Wells or Logistics check unticked for a field project or
  well (§7): no icon, not counted.

---

## 13. FAQ

**I can't see a project.** Access is per project — ask its planner or an admin to add
you with the right role.

**Why won't it let me submit for approval?** Most often a **rig conflict** (red
outline on the chart). Resolve the overlap, then resubmit.

**I submitted but it didn't get approved automatically.** You need **at least one
designated approver**, and **all** of them must sign. With zero approvers it stays
pending on purpose.

**Why can't I edit the plan right now?** It's **locked** because a revision is
pending, or because the plan has been approved. A pending revision unlocks the plan
when it's rejected, sent back, or discarded. An approved plan **stays locked** until
a planner clicks **Revise Plan**. Wells and Logistics readiness stay editable either
way.

**A bar looks "off" / has a red border.** That red border means a rig double-booking
— it's the app warning you, not a display glitch.

**Can I undo a rejection?** A **Reject** is final for that revision. Make the changes
and submit a **new** revision. (Use **Request changes** instead of Reject if you want
it to come back for edits.)

---

*Questions or access issues: contact your project planner or a Drilling Sequence
admin.*
