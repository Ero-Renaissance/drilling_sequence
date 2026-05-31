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

1. Open the app link your IT team gave you (e.g.
   `https://drilling.renaissanceafrica.com`).
2. Click **Sign in with Microsoft** and use your normal Renaissance work account.
   There's no separate password to remember.
3. You'll land on the **Dashboard**.

If you can't sign in or can't see a project you expect, contact your project's
planner or an admin — access is granted per project (see Roles below).

---

## 3. Roles — who can do what

Roles are set **per project**. One person can be a planner on one project and a
viewer on another.

| Role | Can do |
|---|---|
| **Viewer** | Read everything: the schedule, readiness, history. Cannot change anything. |
| **Reviewer** | Everything a viewer can, plus take part in review. |
| **Approver** | Sign off on a submitted plan. (Approvers are chosen by **email** and may even be people outside the project.) |
| **Planner** | The schedule owner: create/edit activities, manage readiness and contracts, submit for approval, clone the project. |
| **Admin** (global) | Application-wide administration; can act across all projects. Managed on the **Admin** page. |

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

### Mark progress
When an activity is finished, mark it **complete**. Completed activities "release"
the rig (they no longer count toward rig conflicts) and are dropped when you clone
the project for the next quarter.

---

## 7. Readiness checks

On the **Readiness** tab, each activity has a set of gates. Set each to a status:
**Not Started, In Progress, Completed, Behind, or N/A**.

The checks (oil & gas specific):

| Code | Meaning |
|---|---|
| **BUD** | Budget |
| **LLI** | Long Lead Items |
| **LOC** | Location |
| **FID** | Final Investment Decision |
| **EIA** | Environmental Assessment |
| **FLOOD** | Flood Assessment |
| **SUBS** | Subsurface |
| **CON** | Contract |

These statuses also show as the little icons under each bar on the chart, so anyone
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
 Designate approvers  ──►  Submit for approval  ──►  a "revision" (snapshot) is created
   (by email, on the          (Approvals tab)          and the plan is LOCKED from edits
    Approvals/project)
        │
        ▼
 Each approver signs
        │
        ├─ all designated approvers signed (and there's ≥1)  ──►  APPROVED ✅
        ├─ an approver Rejects (with a reason)               ──►  REJECTED ⛔ (final)
        └─ an approver Requests changes (with a reason)      ──►  sent back for edits ✏️
```

Key rules to know:
- **Submitting locks the plan.** While a revision is pending approval, the
  activities/readiness/contracts are frozen so reviewers see a stable snapshot.
  (Editing a locked item is refused.)
- **Auto-approval needs at least one approver.** If you submit with **zero**
  approvers configured, it sits as *pending* — it will **not** auto-approve. Add
  approvers so there's someone to sign.
- **Both "decline" outcomes need a reason** (1–2000 characters): **Reject** is final;
  **Request changes** sends it back so the planner can revise and resubmit. Either
  way the plan unlocks.
- **Everything is logged.** Sign, approve, reject, discard, approver add/remove,
  project create/clone — all captured on the **Activity Log** for the audit trail.

If you're an **approver**, you'll be notified (by email, if configured) when a plan
needs your signature. Open the project → **Approvals** → review → sign / reject /
request changes.

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
- **Readiness statuses** — `Not Started`, `In Progress`, `Completed`, `Behind`, `N/A`.

---

## 13. FAQ

**I can't see a project.** Access is per project — ask its planner or an admin to add
you with the right role.

**Why won't it let me submit for approval?** Most often a **rig conflict** (red
outline on the chart). Resolve the overlap, then resubmit.

**I submitted but it didn't get approved automatically.** You need **at least one
designated approver**, and **all** of them must sign. With zero approvers it stays
pending on purpose.

**Why can't I edit the plan right now?** It's probably **locked** because a revision
is pending approval. It unlocks once the revision is approved, rejected, or sent
back.

**A bar looks "off" / has a red border.** That red border means a rig double-booking
— it's the app warning you, not a display glitch.

**Can I undo a rejection?** A **Reject** is final for that revision. Make the changes
and submit a **new** revision. (Use **Request changes** instead of Reject if you want
it to come back for edits.)

---

*Questions or access issues: contact your project planner or a Drilling Sequence
admin.*
