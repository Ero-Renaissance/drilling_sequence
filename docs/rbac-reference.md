# RBAC Reference — who can do what

**Status:** reference for the access model as **currently enforced in code**.
**Audience:** maintainers, IT security reviewers, and anyone assigning project roles.
**Source of truth:** `backend/app/core/rbac.py` and the `allowed_roles=` gates in
`backend/app/routers/*`. If this doc and the code disagree, the code wins — update
this doc.

---

## 1. The two kinds of role

### Global: `admin`
A single boolean on the user (`User.is_admin`). It is **per-user and global**, not
per-project. A global admin bypasses every project-level check (it's the first line of
each helper in `rbac.py`).

Admin is **resolved additively at login** (`app/core/auth.py::_resolve_admin`): a user
is admin if the manual `is_admin` flag is set **or** the Azure AD token's `roles` claim
grants it **or** their email is in the `admin_emails` allowlist. It is **never
auto-revoked** from those sources — `new_is_admin = user.is_admin or is_admin`.

### Per-project: `ProjectRole`
Held via `ProjectMember` (one row per user per project). The enum
(`app/models/project.py`) has four values:

```
planner | reviewer | approver | viewer
```

The user who **creates** a project is added as `planner` (`projects.py:92`); a clone's
creator likewise becomes `planner` (`projects.py:150`).

---

## 2. The three authorization helpers

Every endpoint calls exactly one of these at the top, before any object lookup. Default
is deny.

| Helper | Passes for | Used to gate |
|---|---|---|
| `assert_member(pid, user, db)` | global admin, **or** any `ProjectMember` (any role) | reads: view plan, list revisions, dashboard, readiness, contracts |
| `assert_member(pid, user, db, allowed_roles={ProjectRole.planner})` | global admin, **or** a member whose role is `planner` | all writes / mutations |
| `assert_can_view(pid, user, db)` | global admin, **or** a designated signer (approver/reviewer) by email, **or** any member | view revision **diffs** / Compare |
| `assert_can_sign(pid, user, db)` | global admin, **or** a designated **approver** (by email, `kind="approver"`) | sign / approve / decline a revision |

`assert_can_view` is deliberately **broader than membership**: a designated signer is
matched by **lowercased email** and may not be a `ProjectMember` at all, yet must be able
to review the change they're asked to approve.

`assert_can_sign` was **narrowed** (commit 2a): being a non-viewer member no longer
grants signing rights. Approval authority is the designated-approver email matrix, not a
side effect of membership. Separation of duties (the submitter can't sign their own
revision) is enforced at the endpoint — see §5a.

All denials raise a generic `403 "Access denied"` (or `"Insufficient role for this
action"`) — they never reveal whether the resource exists.

---

## 3. Capability matrix (as enforced today)

Roles gate **editing and visibility**. Sign-off authority (both stages) lives in the
email matrices, not the roles — read the role columns for write/read access and the two
right-hand columns for who may sign.

| Capability | viewer | reviewer | approver | planner | admin | desig. reviewer (email) | desig. approver (email) |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| View plan / revisions / dashboard / readiness / contracts | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| View diffs / Compare | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Sign off review** / request review-changes (review stage) | ❌ | ❌ | ❌ | ❌ | ✅ | ✅¹ | ❌ |
| **Sign** / reject / request-changes (approval stage) | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ✅¹ |
| Edit activities (create/update/delete/import) | ❌ | ❌ | ❌ | ✅ | ✅ | — | — |
| Edit readiness checks | ❌ | ❌ | ❌ | ✅ | ✅ | — | — |
| Edit rig contracts | ❌ | ❌ | ❌ | ✅ | ✅ | — | — |
| Submit a revision (+ pick the route) | ❌ | ❌ | ❌ | ✅ | ✅ | — | — |
| Discard a revision | ❌ | ❌ | ❌ | ✅ | ✅ | — | — |
| Clone the project | ❌ | ❌ | ❌ | ✅ | ✅ | — | — |
| Add/remove designated reviewers/approvers; set review policy | ❌ | ❌ | ❌ | ✅ | ✅ | — | — |
| Edit / archive project | ❌ | ❌ | ❌ | ✅ | ✅ | — | — |

¹ And **never on a revision they themselves submitted** (separation of duties, §5a). A
reviewer can request changes (bounce back) but **cannot** terminally reject — that stays
with approvers.

> **Signing is not a role capability.** The `reviewer`/`approver`/`planner` columns are
> all ❌ for both sign rows: a *role* never grants signing. Only a global admin, a
> **designated reviewer** (review stage), or a **designated approver** (approval stage) —
> each matched by email (`ProjectApprover.kind`) — may sign, independent of project
> membership.

So the per-project roles really gate two things: `planner` (the only writer + route
picker) and everyone else (read-only). The `reviewer`/`approver` *roles* grant nothing
beyond read access; the **email matrices** carry all sign-off authority. See
`docs/review-approval-workflow-spec.md` for the full two-stage state machine.

---

## 4. Designated approvers — where approval authority actually lives

"Who can approve" is **not** members-only and is **not** the `approver` ProjectRole. It
is the `ProjectApprover` entity — an **email** attached to the project, orthogonal to
`ProjectMember`, and possibly external to it.

A revision auto-approves only when **every** configured approver email has signed:

- `_all_required_have_signed` checks that the set of required approver emails (minus the
  creator, §5a) is a **subset** of the signed approval-stage emails (matched lowercased).
- **At least one** designated approver must be configured. With **zero** approvers, the
  revision stays `pending_approval` forever — it **never** auto-approves.

Since commit 2a, only a global admin or a designated approver can sign **at all** — a
plain member's signature is no longer possible. An admin who isn't on the approver list
may sign, but it doesn't count toward the required set, so it won't tip the revision to
`approved`.

The approver matrix is `kind="approver"`. The reviewer matrix (`kind="reviewer"`) shares
the same `ProjectApprover` table but is a separate list for the review stage; the
approval count (`stage="approval"` signatures) never includes reviewers or review-stage
signatures.

---

## 4a. The review stage (mirror of approval, one step earlier)

Optional technical review runs *before* approval, governed by `Project.review_policy`
(`required` / `optional` / `off`). When a revision is routed through review
(`status="pending_review"`):

- The **reviewer matrix** (`kind="reviewer"`) is the required set; **all** must sign
  (`Signature.stage="review"`, gated by `assert_can_review`) for the revision to advance
  to `pending_approval`. Same all-must-sign + creator-excluded rules as approval.
- A reviewer may instead **request changes** (`review-changes`) — a non-terminal bounce
  back, with a reason; reviewers **cannot** reject.
- A revision submitted straight to approval under an `optional` policy is flagged
  `review_skipped` so approvers can see review was bypassed.

Full state machine and routing rules: `docs/review-approval-workflow-spec.md`.

---

## 5. The decline path

A pending revision can be closed two ways, both via `_record_decision`, both gated by
`assert_can_sign` (so: admin or a designated approver):

- **`rejected`** — terminal.
- **`changes_requested`** — sent back to the planner for revision.

Both **require a non-empty reason** (1–2000 chars; empty → `422`), both **unlock** the
revision's activities, and both are only valid while the revision is `pending_approval`.
Declining has the **same** authority requirement as signing (admin / designated
approver) — and is likewise subject to separation of duties (§5a).

---

## 5a. Separation of duties — nobody decides on their own plan

Enforced at every sign / sign-review / reject / request-changes / review-changes
endpoint, and in both the review and approval counts:

- The revision's `created_by` user **cannot** sign, sign-off review, reject, or
  request-changes it — even if they're a designated reviewer/approver or a global admin.
  They may only **discard** it.
- The creator is **excluded from their revision's required reviewer/approver sets**; if
  that leaves a set empty, that stage can never auto-complete.
- **Submit is blocked** (409) when the submitter is the *only* eligible approver (always),
  or the *only* eligible reviewer when routing through review.

This is an **integrity** rule: admin bypasses *access* checks, but not this one.

---

## 6. Auditability

Every governance action — submit (`submitted_for_review` / `submitted_for_approval`),
`review_signed`, `review_completed`, `review_changes_requested`, sign, approve, reject,
request-changes, discard, reviewer/approver add/remove, `review_policy_changed`, and
project create/clone — emits an append-only event via
`app/services/audit.py::governance_event`. The audit log is **read-only**: there is no
update/delete endpoint for it.

---

## 7. Roles vs. the email matrices (the key mental model)

Signing authority is governed entirely by the two email-based matrices, so the
`reviewer` and `approver` **ProjectRoles** grant nothing beyond a member's read access —
they're labels for editing/visibility, not sign-off boundaries. Authority is:

- **Review stage** → the `kind="reviewer"` matrix (`assert_can_review`).
- **Approval stage** → the `kind="approver"` matrix (`assert_can_sign`).

A person is on a matrix by **email**, may not be a project member at all, and may be on
both. The roles answer "who can edit / who can submit"; the matrices answer "who must
sign". Keep the two concepts separate — that separation is what lets approvers be
external to the project and survive quarterly clones.
