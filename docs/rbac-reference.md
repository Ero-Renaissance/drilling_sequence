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
| `assert_can_view(pid, user, db)` | global admin, **or** a designated approver (by email), **or** any member | view revision **diffs** / Compare |
| `assert_can_sign(pid, user, db)` | global admin, **or** a designated approver (by email), **or** any **non-viewer** member | sign / approve / decline a revision |

`assert_can_view` and `assert_can_sign` are deliberately **broader than membership**: a
designated approver is matched by **lowercased email** and may not be a `ProjectMember`
at all, yet must be able to review and sign the change they're asked to approve.

All denials raise a generic `403 "Access denied"` (or `"Insufficient role for this
action"`) — they never reveal whether the resource exists.

---

## 3. Capability matrix (as enforced today)

| Capability | viewer | reviewer | approver | planner | admin |
|---|:--:|:--:|:--:|:--:|:--:|
| View plan / revisions / dashboard / readiness / contracts | ✅ | ✅ | ✅ | ✅ | ✅ |
| View diffs / Compare | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Sign** a pending revision | ❌ | ✅ | ✅ | ✅ | ✅ |
| **Decline** (reject / request changes) | ❌ | ✅ | ✅ | ✅ | ✅ |
| Edit activities (create/update/delete/import) | ❌ | ❌ | ❌ | ✅ | ✅ |
| Edit readiness checks | ❌ | ❌ | ❌ | ✅ | ✅ |
| Edit rig contracts | ❌ | ❌ | ❌ | ✅ | ✅ |
| Submit a revision for approval | ❌ | ❌ | ❌ | ✅ | ✅ |
| Discard a revision | ❌ | ❌ | ❌ | ✅ | ✅ |
| Clone the project | ❌ | ❌ | ❌ | ✅ | ✅ |
| Add/remove designated approvers | ❌ | ❌ | ❌ | ✅ | ✅ |
| Edit / archive project | ❌ | ❌ | ❌ | ✅ | ✅ |

In enforced terms the four labels collapse to **three tiers**: `planner` (the only
writer), `reviewer`/`approver` (read + sign/decline), and `viewer` (read-only).

---

## 4. Designated approvers — where approval authority actually lives

"Who can approve" is **not** members-only and is **not** the `approver` ProjectRole. It
is the `ProjectApprover` entity — an **email** attached to the project, orthogonal to
`ProjectMember`, and possibly external to it.

A revision auto-approves only when **every** configured approver email has signed:

- `_all_required_have_signed` (`revisions.py:110`) checks that the set of required
  approver emails is a **subset** of the signed emails (matched lowercased).
- **At least one** designated approver must be configured. With **zero** approvers,
  signing is allowed but the revision stays `pending_approval` forever — it **never**
  auto-approves (`return False` on the empty list).

So a signature from a `reviewer`/`approver` **member** only drives approval **if that
person's email is also on the designated-approver list**. Otherwise their signature is
recorded and audited, but doesn't move the revision to `approved`.

---

## 5. The decline path (asymmetric with approve — by design)

A pending revision can be closed two ways, both via `_record_decision`
(`revisions.py:533`), both gated by `assert_can_sign`:

- **`rejected`** — terminal.
- **`changes_requested`** — sent back to the planner for revision.

Both **require a non-empty reason** (1–2000 chars; empty → `422`), both **unlock** the
revision's activities, and both are only valid while the revision is `pending_approval`.

**Decline is broader than approve.** Approval needs the *full* designated-approver set to
sign; a decline can be issued by **any single non-viewer member** (reviewer or approver
role), regardless of the approver list. The model makes it easy to halt a revision and
hard to approve one.

---

## 6. Auditability

Every governance action — sign, approve, reject, request-changes, discard, approver
add/remove, and project create/clone — emits an append-only event via
`app/services/audit.py::governance_event`. The audit log is **read-only**: there is no
update/delete endpoint for it.

---

## 7. Known gap: `reviewer` and `approver` are not distinguished

Nothing in `rbac.py` or the routers checks `ProjectRole.reviewer` versus
`ProjectRole.approver`. Both qualify only as "non-viewer member" in `assert_can_sign`,
so **today they have identical capability**. The split is currently intent/labeling, not
an access boundary. See the workflow discussion for whether (and how) to give the two
roles distinct meaning.
