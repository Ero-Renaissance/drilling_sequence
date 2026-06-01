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

| Capability | viewer | reviewer | approver | planner | admin | designated approver (email) |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| View plan / revisions / dashboard / readiness / contracts | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| View diffs / Compare | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Sign** a pending revision | ❌ | ❌ | ❌ | ❌ | ✅ | ✅¹ |
| **Decline** (reject / request changes) | ❌ | ❌ | ❌ | ❌ | ✅ | ✅¹ |
| Edit activities (create/update/delete/import) | ❌ | ❌ | ❌ | ✅ | ✅ | — |
| Edit readiness checks | ❌ | ❌ | ❌ | ✅ | ✅ | — |
| Edit rig contracts | ❌ | ❌ | ❌ | ✅ | ✅ | — |
| Submit a revision for approval | ❌ | ❌ | ❌ | ✅ | ✅ | — |
| Discard a revision | ❌ | ❌ | ❌ | ✅ | ✅ | — |
| Clone the project | ❌ | ❌ | ❌ | ✅ | ✅ | — |
| Add/remove designated approvers | ❌ | ❌ | ❌ | ✅ | ✅ | — |
| Edit / archive project | ❌ | ❌ | ❌ | ✅ | ✅ | — |

¹ And **never on a revision they themselves submitted** (separation of duties, §5a).

> **Signing is not a role capability.** Note the `reviewer`/`approver`/`planner` columns
> are all ❌ for sign/decline: a *role* never grants signing. Only a global admin or a
> **designated approver matched by email** (`ProjectApprover`, §4) can sign or decline —
> independent of whether that person is even a project member.

In enforced terms the per-project roles collapse to just two that matter: `planner`
(the only writer) and everyone else (read-only). The `reviewer` and `approver` *roles*
currently grant nothing beyond a plain member's read access — signing authority lives
entirely in the email-based approver matrix. (The forthcoming review stage gives
`reviewer` real meaning via a parallel email matrix — see
`docs/review-approval-workflow-spec.md`, in progress.)

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
the same `ProjectApprover` table but is a separate list for the review stage (in
progress); the approval count never includes reviewers or review-stage signatures.

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

Enforced at every sign / reject / request-changes endpoint, and in the approval count:

- The revision's `created_by` user **cannot** sign, reject, or request-changes it — even
  if they're a designated approver or a global admin. They may only **discard** it.
- The creator is **excluded from their revision's required-approver set**; if that leaves
  the set empty, the revision can never auto-approve.
- **Submit is blocked** (409) when the submitter is the *only* configured approver, so a
  revision can't be created that no one is eligible to approve.

This is an **integrity** rule: admin bypasses *access* checks, but not this one.

---

## 6. Auditability

Every governance action — sign, approve, reject, request-changes, discard, approver
add/remove, and project create/clone — emits an append-only event via
`app/services/audit.py::governance_event`. The audit log is **read-only**: there is no
update/delete endpoint for it.

---

## 7. The `reviewer` / `approver` roles, and what's in flight

After commit 2a, signing is governed entirely by the email-based approver matrix, so the
`reviewer` and `approver` **roles** currently grant nothing beyond a member's read
access — they're labels, not access boundaries.

The in-progress **review → approval** workflow
(`docs/review-approval-workflow-spec.md`) gives `reviewer` real meaning: a separate
designated-reviewer email matrix (`ProjectApprover.kind="reviewer"`) whose members all
sign a *review* stage (`Signature.stage="review"`) before approval, with reviewers
limited to request-changes (no terminal reject). When that lands, this section and the
matrix above will be updated to match.
