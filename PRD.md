# Product Requirements Document
## Drilling Sequence Planning Tool — v2.0

**Date:** May 2026
**Status:** Implemented — Phases 1–8 shipped, plus an enterprise-readiness hardening pass (see §10)
**Stack:** FastAPI · React 18 · TypeScript · PostgreSQL

---

## 1. Vision

A modern, browser-based internal tool for oil & gas project managers and planners to build, manage, and formally approve drilling sequence schedules. Replaces the current Streamlit CSV-upload-and-export workflow with a **persistent platform** where the chart is a living document — not a one-shot file export.

Management can view the live schedule in the app and sign off digitally. A print-to-PDF path is preserved for anyone who prefers a physical signature.

---

## 2. Users & Roles

**Per-project roles** (assigned via `ProjectMember`, scoped to a single project):

| Role | Description |
|---|---|
| **Planner** | Creates and edits drilling schedules, imports data, manages projects, creates revisions |
| **Reviewer** | Browses charts, updates readiness check statuses |
| **Approver** | Formally signs off on a chart revision (management) |
| **Viewer** | Read-only access to charts and dashboards |

**Global role:**

| Role | Description |
|---|---|
| **Admin** | `User.is_admin` flag. Bypasses all per-project membership checks and manages users via the Admin page. Granted additively at login from an Azure AD app role or a bootstrap email allowlist (never auto-revoked — see §3). |

> **Designated approvers** are a separate, email-based concept (`ProjectApprover`) orthogonal to membership: a revision can only be auto-approved once every designated approver has signed. A designated approver may be matched by email even if they are not a project member.

**Primary persona:** Project managers and planners who build and maintain the schedule daily.
**Secondary persona:** Management approvers who review and sign revisions.

All users are internal — authenticated via Microsoft Active Directory.

---

## 3. Authentication

- SSO via **Microsoft Active Directory** (OAuth2/OIDC) — `fastapi-azure-auth` on the backend, MSAL on the frontend
- No username/password forms — the login page redirects to company AD login
- Role is assigned per project (a user can be Planner on Project A and Viewer on Project B)
- No guest/external access required

**Admin determination:** in production the source of truth is an Azure AD app role (`ADMIN_ROLE`, default `"Admin"`) carried in the token's `roles` claim; `ADMIN_EMAILS` is a comma-separated bootstrap allowlist for the first admins before the AD role is wired up. Admin is resolved **additively** at login — a claim or allowlist entry can grant admin but never revokes a grant made manually in the Admin page.

**Environment hardening (fail-closed):** a `DEV_MODE` flag bypasses Azure AD and injects a fixed "Dev User" for local development. The app **refuses to start** when `ENVIRONMENT=production` and either `DEV_MODE=true` or the Azure credentials are missing — so a production deployment can never silently bypass authentication.

---

## 4. Core Features

### 4.1 Projects

- Create a named drilling campaign or planning horizon
- Attach metadata: field name, operating region, status (Active / Archived)
- Revision tracking built in from day one
- Archive completed projects (read-only)
- All projects the user has access to are listed on the dashboard

---

### 4.2 Data Management

- **Import:** CSV and Excel (.xlsx) file upload — preserves the current workflow
- **Column auto-detection:** Well Name, Rig Name, Activity Type, Location, Plan Type, Readiness Check Status, Contract Expiry Date (same logic as existing `DataProcessor`)
- **Validation:** Missing required columns, date conflicts, and unknown activity types are flagged with actionable error messages
- **In-app data grid:** Edit rows directly in the browser — add wells, change dates, update activity types, delete rows — without re-uploading a file
- Auto-save to database on every edit
- Full audit log: who changed what row, and when

---

### 4.3 Gantt Chart

The core view. Everything in the current chart is preserved and moved into the React frontend:

- Interactive ECharts timeline — zoom, pan, time navigation slider
- Color-coded activity types (colors editable per project)
- Today's date vertical line
- Month background bands and grid lines
- Hover tooltips with full activity detail including readiness check statuses
- Location-based Y-axis sorting: LAND → SWAMP → OFFSHORE

**Domain-specific icons (preserved from v1):**

| Category | Icons |
|---|---|
| Readiness checks | BUD (diamond), LLI (square), LOC (triangle-up), FID (star), EIA (hexagon), FLOOD (circle), SUBS (cross) |
| Plan types | Firm (gray), Option (green), Out of Plan (red) |
| Contract expiry | Expired (red), Critical <30d (orange), Warning <90d (yellow), Good (green) |

---

### 4.4 Dashboard / Overview

Summary page shown on login and accessible at all times:

- **KPI cards:** Active projects, total members, **pending approvals** (revisions awaiting *your* sign-off, from `GET /api/me/pending-approvals`), contract alerts (rigs expiring within 90 days)
- **Recent projects list:** Each project with quick links into the chart
- **Upcoming alerts:** Contracts expiring within 90 days

---

### 4.5 Readiness Check Tracker

A dedicated view separate from the Gantt showing readiness status across all wells in a project:

| Well Name | BUD | LLI | LOC | FID | EIA | FLOOD | SUBS |
|---|---|---|---|---|---|---|---|
| Well A | ✓ | ✓ | ⚠ | — | ✓ | — | ✗ |
| Well B | ✓ | — | ✓ | ✓ | — | ✓ | ✓ |

- Inline status editing: click a cell to toggle pass / fail / pending / N/A
- Filter by check type or well
- Color coding: green = pass, red = fail, yellow = pending, gray = N/A
- Changes sync to the Gantt icon display in real time
- Export matrix to Excel *(not yet implemented)*

---

### 4.6 Edit Safety & Change Tracking

Real-time collaborative editing (WebSockets) is deliberately out of scope. The team is small (1–10 users) and the domain demands deliberate, traceable changes — not casual concurrent edits. Instead, the following mechanisms provide safety and accountability:

**Optimistic lock detection**
- Every Activity row carries an `updated_at` timestamp. Before saving a cell edit, the client sends the timestamp it last loaded.
- If the server detects the row has been modified by someone else in the meantime, it returns a `409 Conflict` with the current values and the name of who changed it.
- The user sees a clear warning: *"John updated this row since you opened it — your change was not saved. Review the current value and try again."*

**"Last edited by" in the data grid**
- Each row in the Data tab shows who last changed it and how long ago (e.g. "Sarah, 2 hours ago").
- Gives planners awareness of recent activity without requiring a page refresh.

**Edit lock during approval**
- Once an activity is included in a pending revision (Phase 6), it is locked from editing.
- The data grid cell renders as read-only with a padlock indicator.
- Unlock happens automatically when the revision is approved or discarded.

**Lightweight presence via polling**
- A `GET /api/projects/:id/viewers` endpoint returns who has viewed the project in the last 5 minutes.
- The chart and data tabs show a small avatar strip ("2 others viewing") — no WebSocket required.
- Polling interval: 60 seconds.

**Activity change history**
- Every save to an Activity row writes an entry to the Audit Log: field changed, old value, new value, user, timestamp.
- A "History" side panel on each row shows the last N changes.
- Accessible to Planners and Approvers; read-only for Viewers.

---

### 4.7 Approval & Digital Signature Workflow

Replaces the HTML export as the primary mechanism for formal document control.

**Designated approvers:** each project configures a list of **required approvers** by email (the "Required Approvers" panel). A revision can only reach **Approved** once at least one approver is configured *and* every configured approver has signed. With no approvers configured, a revision can be signed but never auto-approves.

**Flow:**

1. Planner creates a **revision snapshot** (e.g., Rev. 01) — freezes the current state of the schedule and **locks** its activities from editing
2. Designated approvers are **notified by email** that their approval is needed, and the revision appears in their in-app "Pending Approvals" (the source of truth — see §4.4)
3. Each approver opens the **revision detail page** — the single place a decision is made. The Approvals list only offers a **"Review & sign"** button that links here, so a decision can't be taken without first seeing the schedule snapshot and what changed. On that page the approver reviews the interactive chart and **what changed since the previous version** (see "Change comparison" below), then takes one of three actions:
   - **Sign & Approve** — records signer name, role, and timestamp, immutably attached to the revision
   - **Request changes** — sends the revision back so the planner can revise and resubmit; activities are unlocked
   - **Reject** — declines the revision (terminal); activities are unlocked
4. **Request changes / Reject both require a reason**, which is recorded on the revision (`decision_reason`, `decision_by`, `decision_at`) and emitted to the audit log. The planner who created the revision is **emailed** the outcome and reason.
5. Once all required approvers have signed, the revision is marked **Approved** and locked
6. Any subsequent edits create a new revision (Rev. 02, etc.)

**Revision statuses:** `pending_approval` → `approved` | `rejected` | `changes_requested` | `discarded`.

**Revision history:** Any past revision can be viewed as a read-only snapshot — chart, KPI summary, readiness matrix, full signature record, and the decision reason where applicable.

**Change comparison (revision diff):** Surfaced in two places, by audience:
- **Compare tab** (project nav, after Readiness) — planner-driven, with **free base + target pickers** (either side can be any revision or the **current working plan (live)**). Defaults to **latest approved revision → live** ("what have I changed since sign-off?").
- **Revision detail page** "Compare with" panel — approver-driven, auto-anchored to the revision being reviewed (defaults to the **previous revision**) so changes are visible before signing.

Activities are matched by stable id, so the diff reports **added / removed / modified** activities with field-level **old → new** values (including per-readiness-check changes), under a headline summary of counts and the **start / end / duration day-shifts**. Both views share one UI (`diff-shared.tsx`) and are backed by `GET /api/projects/:id/revisions/compare` (any project member).

**Print to PDF (fallback path):**

- The revision detail page (`/projects/:id/revisions/:revId`) carries print-optimized CSS: collapsed sections expand and chrome is hidden when printed, yielding chart + KPI summary + readiness matrix + signature table
- Management prints via browser Ctrl+P for physical sign-off if preferred
- No HTML file is generated server-side — the browser handles rendering
- *(No separate `/print` route — print styling lives on the revision detail view itself.)*

---

### 4.8 Export

| Export | Format | Notes | Status |
|---|---|---|---|
| Revision print view | PDF (via browser print) | Chart + KPIs + readiness + signatures — print CSS on the revision detail page | ✅ Done |
| Readiness check matrix | Excel (.xlsx) | For distribution to field teams | ⬜ Not yet implemented |

> The standalone HTML file export from v1 is **removed**. The React app is the frontend. Sharing is done via links, not files.

---

## 5. Out of Scope for v2.0

The following are explicitly deferred:

- Mobile / tablet support — desktop browsers only (Chrome, Edge, Firefox)
- ERP / SAP / drilling management software integrations
- External / guest approver access — all users are on AD
- Additional chart types (resource histograms, S-curves) — Gantt only
- Public sharing or unauthenticated links
- Real-time collaborative editing (WebSockets) — see §4.6

> **Update:** "Email notifications — in-app only" was originally out of scope but is now **implemented**. Designated approvers are emailed when a revision needs their signature, and planners are emailed when their revision is rejected or sent back. Email sends via the company internal SMTP relay and is **disabled by default** (`SMTP_HOST` blank) — a no-op until IT provides relay details, so it never blocks the app. In-app notifications remain the source of truth.

---

## 6. Tech Stack

| Layer | Technology | Rationale |
|---|---|---|
| Frontend | React 18 + TypeScript + Vite | Modern, type-safe, fast dev experience |
| UI components | shadcn/ui + Tailwind CSS | Composable, no heavy vendor lock-in, clean defaults |
| Chart | ECharts (echarts-for-react) | Frontend-rendered, ~900KB, modern Gantt with custom series |
| Data grid | TanStack Table v8 | Headless, flexible, pairs well with Tailwind |
| Client state | Zustand | Simple, low boilerplate |
| Backend | Python 3.11 + FastAPI | Reuses all existing processing code with zero rewrite |
| Auth | fastapi-azure-auth + MSAL | Microsoft AD SSO |
| Email | stdlib `smtplib` → company SMTP relay | Fire-and-forget notifications; no external provider, no per-message cost |
| ORM | SQLAlchemy 2.0 + Alembic | Type-safe queries, schema migrations |
| Database | PostgreSQL 15 | Reliable, JSONB support for snapshot storage |
| File parsing | pandas + openpyxl (existing) | DataProcessor reused as a service module |
| Print/PDF | Browser native (print CSS) | No server-side PDF library needed |

---

## 7. Application Routes

```
/                               Redirect to /dashboard
/login                          SSO redirect to Microsoft AD (or "Continue as Dev User" in dev)

/dashboard                      KPI overview + recent projects + pending approvals

/projects                       All accessible projects (create via dialog — no /new route)

/admin                          User management (Admin only — guarded route)

/projects/:id/chart             Gantt chart (default project view)
/projects/:id/data              In-app data grid editor
/projects/:id/readiness         Readiness check tracker
/projects/:id/compare           Change comparison — free base/target pickers (revision or live)
/projects/:id/signatures        Revision list — "Review & sign" links to the detail page; planner can discard
/projects/:id/activity          Project activity & governance audit log

/projects/:id/revisions/:revId  Revision snapshot + decision actions (sign / request-changes / reject); print via Ctrl+P
```

---

## 8. API Design

```
# Auth & current user
GET    /api/auth/me
GET    /api/me/pending-approvals                    # Revisions awaiting my signature (cross-project)

# Admin (Admin only)
GET    /api/admin/users
PATCH  /api/admin/users/:userId                     # Grant/revoke is_admin

# Projects
GET    /api/projects
POST   /api/projects
GET    /api/projects/:id
PATCH  /api/projects/:id
DELETE /api/projects/:id                            # Archives (soft delete) the project
POST   /api/projects/:id/clone                      # Clone for a new planning horizon
GET    /api/projects/:id/audit                      # Project audit feed (edits + governance events)

# Activities (schedule rows)
GET    /api/projects/:id/activities
POST   /api/projects/:id/activities
PATCH  /api/projects/:id/activities/:actId          # Optimistic lock via expected_updated_at → 409 on stale write
DELETE /api/projects/:id/activities/:actId
POST   /api/projects/:id/activities/import          # CSV / Excel upload
GET    /api/projects/:id/activities/:actId/history  # Audit log for one activity

# Readiness
GET    /api/projects/:id/readiness
PUT    /api/projects/:id/activities/:actId/readiness/:checkCode

# Rig contracts
GET    /api/projects/:id/contracts
PUT    /api/projects/:id/contracts/:rigName
DELETE /api/projects/:id/contracts/:rigName

# Presence
GET    /api/projects/:id/viewers                    # Who viewed this project in last 5 min

# Designated approvers
GET    /api/projects/:id/approvers
POST   /api/projects/:id/approvers                  # Planner only
DELETE /api/projects/:id/approvers/:approverId      # Planner only

# Revisions, signatures & decisions
GET    /api/projects/:id/revisions
POST   /api/projects/:id/revisions                  # Snapshot current state → locks activities (Planner)
GET    /api/projects/:id/revisions/compare          # Diff two snapshots: ?base=<revId|live>&target=<revId|live>
GET    /api/projects/:id/revisions/:revId
PUT    /api/projects/:id/revisions/:revId/sign
DELETE /api/projects/:id/revisions/:revId           # Discard a pending revision (Planner)
POST   /api/projects/:id/revisions/:revId/reject            # Decline (terminal) — reason required
POST   /api/projects/:id/revisions/:revId/request-changes   # Send back — reason required
```

> **RBAC:** every project-scoped route enforces membership via a shared helper (`app/core/rbac.py`). Reads require any member; planner-only actions (create/discard revision, manage approvers, edit schedule) require the planner role; signing/decisions require a non-viewer member, a designated approver (by email), or an admin. Admins bypass per-project checks. Email/Excel readiness export endpoint is **not yet implemented**.

---

## 9. Data Model

```
User
  id, ad_object_id, name, email, is_admin (bool)

Project
  id, name, field, region, status (active|archived), created_by, created_at

ProjectMember
  project_id, user_id, role (planner|reviewer|approver|viewer)

ProjectApprover                            # designated required approvers, by email
  id, project_id, email, name, role_label
  (unique per project+email)

Activity
  id, project_id, well_name, rig_name, activity_type, location,
  start_date, end_date, plan_type, risk, comment,
  rig_contract_expiry_date, rig_contract_days_remaining,
  readiness_check, readiness_check_status,
  created_at, updated_at, updated_by (→ User)
  locked_by_revision_id (→ Revision | null)  # set when included in a pending revision

ReadinessCheck
  id, activity_id (→ Activity CASCADE), check_code (BUD|LLI|LOC|FID|EIA|FLOOD|SUBS),
  status (Not Started|In Progress|Completed|N/A), notes, updated_at

RigContract                                # rig contract — binding once status = Completed
  id, project_id, rig_name, status (N/A|Not Started|In Progress|Completed),
  contract_start, contract_end, notes, updated_at, updated_by (→ User)
  (unique per project+rig_name)

ProjectViewer                              # lightweight presence
  project_id, user_id, last_seen_at       # upserted on each page load; TTL 5 min

AuditLog                                   # serves both field edits AND governance events
  id, project_id, user_id (→ User), entity_type, entity_id,
  field, old_value, new_value, timestamp
  # field edits: entity_type=activity, field=column name
  # governance events: entity_type in {revision, approver, project},
  #   field=action verb (created|cloned|signed|approved|rejected|
  #   changes_requested|discarded|added|removed), new_value=human detail

Revision
  id, project_id, rev_number, label, snapshot_json,
  status (pending_approval|approved|rejected|changes_requested|discarded),
  created_by, created_at,
  decision_reason, decision_by (→ User), decision_at   # set on reject / request-changes

Signature
  id, revision_id, user_id, role_label, signed_at
```

---

## 10. Implementation Phases

| Phase | Scope | Deliverable | Status |
|---|---|---|---|
| **1 — Foundation** | FastAPI skeleton, SQLite/PostgreSQL schema, AD SSO, project CRUD, React shell | Authenticated shell — login works, projects can be created | ✅ Done |
| **2 — Chart** | ECharts Gantt, CSV/Excel import, chart-utils data transform | Feature parity with current Streamlit app | ✅ Done |
| **3 — Data Grid** | TanStack Table editor, inline editing, optimistic updates, create/delete | No more CSV re-upload for edits | ✅ Done |
| **4 — Readiness Tracker** | ReadinessCheck table, matrix grid UI, status cycling, readiness section in chart tooltip | Dedicated readiness workflow surfaced in chart | ✅ Done |
| **5 — Edit Safety** | `updated_by` on Activity, optimistic lock detection (409 on stale write), "last edited by" in grid, lightweight presence polling, per-row change history panel, edit lock when activity is in a pending revision | Safe multi-user editing without real-time infrastructure | ✅ Done |
| **6 — Approvals** | Revision snapshots, digital signature flow, revision history, read-only snapshot view, activity locking on pending revision | Formal sign-off workflow | ✅ Done |
| **7 — Print / PDF** | Print-optimized CSS for revision view (Excel readiness export still pending) | PDF output via browser print | 🟨 Print done; Excel export pending |
| **8 — Dashboard** | KPI cards (active projects, members, pending approvals, contract alerts), recent projects, contract alerts | Overview page | ✅ Done |
| **9 — Enterprise Readiness** | Route-level RBAC enforcement (shared helper), immutable governance audit log + project audit feed, global Admin role + user-management page, project clone, rig-contract tracking, approval-workflow hardening (required approvers, reject/request-changes with reasons), fail-closed production auth guard, email notifications (approver-pending + planner-decision) | Hardened for internal company deployment | ✅ Done |

---

## 11. Non-Functional Requirements

| Requirement | Target |
|---|---|
| Concurrent users | 1–10 |
| Projects | < 20 active at any time |
| Chart render time | < 3 seconds for typical datasets (< 500 activities) |
| Browser support | Chrome, Edge, Firefox (latest) — desktop only |
| Deployment | Internal network — on-premises server or private cloud |
| Availability | Business hours; no HA requirement for v2.0 |
