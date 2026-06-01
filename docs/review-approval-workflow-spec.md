# Spec: Two-stage Review → Approval workflow

**Status:** design spec — no code yet.
**Audience for the feature:** planners (submit + route), reviewers (technical
concurrence), approvers (binding sign-off), and project governance owners.
**One-liner:** add an optional **technical review** stage in front of the existing
approval stage, let the planner route a revision through review or straight to
approval (within a project policy), and enforce that **nobody approves their own plan.**

This builds on `docs/rbac-reference.md` (the access model) and the existing revision
workflow in `app/routers/revisions.py`. It does **not** change the binding approval
gate: the email-based designated-approver matrix (the 5 GMs) still decides `approved`.

---

## 1. Goal & principles

- **Two genuinely different checks.** *Review* = technical concurrence (disciplines
  sanity-check feasibility, readiness, contracts, sequencing). *Approval* = binding
  authority sign-off. Review is an upstream pre-check, not the final gate.
- **Route by magnitude.** A date nudge shouldn't need the same ceremony as
  re-sequencing a campaign. The planner chooses the route — *within a project policy*
  a governance owner sets.
- **Separation of duties.** The person who submits a plan can neither review nor
  approve it. (§6 — the rule the user asked for, generalised.)
- **No silent bypass.** When review is skipped, the revision is *visibly* marked
  "skipped technical review" so approvers can push back. Transparent, not hidden.
- **Auditable.** Every stage transition emits an append-only governance event
  (`app/services/audit.py::governance_event`). Reuse the existing locking and
  decision-reason machinery; don't reinvent it.
- **Cheap where possible.** `Revision.status` is already a free `String(32)`, so a new
  `pending_review` value needs no enum migration.

---

## 2. Roles (unchanged set; reviewer retained)

`planner` / `reviewer` / `approver` / `viewer` per project, plus global `admin`.
This spec gives `reviewer` a distinct, enforced meaning for the first time:

| Role | New capability in this workflow |
|---|---|
| planner | Submits a revision and picks its route (where policy allows). Cannot review or approve it (§6). |
| reviewer | Endorses or requests-changes a revision **at the review stage**. Cannot sign, cannot terminally reject. |
| approver | Signs / rejects / requests-changes **at the approval stage** (as today), subject to §6. |
| viewer | Read-only (unchanged). |
| admin | Bypasses *access* checks, but **not** the separation-of-duties rule (§6). |

---

## 3. State machine

New status: **`pending_review`**. All others already exist.

```
                      ┌──── route: review ───→ pending_review ──(review complete)──┐
  submit (planner) ───┤                              │                             ▼
                      └──── route: direct ──────────────────────────────────→ pending_approval
                                                     │ (reviewer requests changes)      │
                                                     ▼                                   │ (all required approvers sign, §6)
                                              changes_requested ◄──(approver requests changes)──┤
                                              (back to planner;                          │ (approver rejects)
                                               activities unlock)                        ▼
                                                                                    approved / rejected
  any non-terminal ──(planner discards)──→ discarded
```

### Transition table

| # | From → To | Trigger / who | Guards | Effects |
|---|---|---|---|---|
| 1 | ∅ → `pending_review` | submit, **planner** | no open revision; ≥1 activity; no rig conflict; ≥1 *eligible* reviewer (§6); route resolves to review | snapshot; lock activities; audit `submitted_for_review` |
| 2 | ∅ → `pending_approval` | submit, **planner** | same, minus reviewer requirement; ≥1 *eligible* approver (§6) | snapshot; lock activities; audit `submitted_for_approval` (flagged `review_skipped` when policy allowed review) |
| 3 | `pending_review` → `pending_approval` | review complete (last endorsement satisfies the rule, §5) | endorsement rule met | audit `review_completed` |
| 4 | `pending_review` → `changes_requested` | request changes, **reviewer** (not creator) | reason 1–2000 chars | unlock; record decision; audit `review_changes_requested` |
| 5 | `pending_approval` → `approved` | required approvers all signed | §6 satisfied; ≥1 required approver | unlock; audit `approved` |
| 6 | `pending_approval` → `rejected` | reject, **approver** (not creator) | reason 1–2000 chars | unlock; record decision; audit `rejected` |
| 7 | `pending_approval` → `changes_requested` | request changes, **approver** (not creator) | reason 1–2000 chars | unlock; record decision; audit `changes_requested` |
| 8 | `pending_review`/`pending_approval` → `discarded` | discard, **planner** | not already approved | unlock; audit `discarded` |

`approved` / `rejected` / `changes_requested` / `discarded` are terminal for that
revision; the planner revises the working plan and submits a *new* revision.

Activities are **locked for the whole time a revision is open** (any pending state) and
unlock on every terminal transition — same `locked_by_revision_id` mechanism as today,
now also held across `pending_review`.

---

## 4. Review policy & routing

The *requirement* for review is a **project-level policy**, so a governance owner — not
the submitter under deadline pressure — decides whether review can be skipped.

`Project.review_policy ∈ { required, optional, off }` (default **`optional`**):

| Policy | Planner's route choice at submit | Resulting status |
|---|---|---|
| `required` | none — review is forced | `pending_review` |
| `optional` | planner picks `request_review: true/false` | `pending_review` or `pending_approval` |
| `off` | none — review unavailable | `pending_approval` |

- Only a **planner** (or admin) may change `review_policy` — same gate as other project
  settings (`assert_member(..., allowed_roles={planner})`), and it emits an audit event.
- The resolved choice is persisted on the revision (`Revision.review_required: bool`) so
  the history shows the route each revision actually took.
- **Visible skip:** when `optional` + `request_review=false`, the revision carries a
  `review_skipped` marker shown in the approval view and the audit detail, so approvers
  see review was bypassed and can request-changes if they want it reviewed.

---

## 5. Who reviews, and when review is "complete"

**Recommended defaults (open to change — see §15):**

- **Reviewer set = project members with role `reviewer`** (a pool; no separate email
  matrix). Review is advisory and internal, so the lighter role-based pool fits; we can
  add a named `ProjectReviewer` matrix later if specific disciplines must each concur.
- **Completion rule = at least one reviewer endorsement** advances the revision to
  `pending_approval`. Simple and unblocking for v1; alternatives are "all reviewers" or
  a quorum.
- **Reviewer powers = endorse or request-changes only.** No binding signature, no
  terminal reject — those stay with approvers (the GMs).

Endorsements are recorded in a new **`ReviewEndorsement`** table (kept separate from
`Signature` so approval-counting in `_all_required_have_signed` can never mistake a
review endorsement for an approval signature):

```
ReviewEndorsement(id, revision_id → revisions, user_id → users, endorsed_at, note?)
```

---

## 6. Separation of duties — nobody approves their own plan

**Rule.** The user recorded as a revision's `created_by` may **not**, on that revision:
endorse its review, cast an approval signature, reject it, or request-changes-as-approver.
They *may* discard it (it's their own draft).

**Scope.** This is an **integrity** rule, not an access rule, so it holds **even for a
global admin and even for a designated approver** — if you submitted it, you can't
approve it. (Admin still bypasses *membership/visibility*, just not this.)

**Interaction with the required-approver matrix.** For a given revision, the required
set is the designated approvers **minus the revision's creator**. So:
- If a GM who is normally an approver happens to submit a revision, they're dropped from
  *that* revision's required signers; the other approvers still gate it.
- If removing the creator empties the required set (e.g. a project with a single approver
  who is also the submitter), the revision **cannot auto-approve** — consistent with the
  existing "zero required approvers ⇒ never auto-approve" rule. Surface this at submit
  time as a blocking validation ("no eligible approver: you can't approve your own
  revision — add another approver"), so it fails early rather than stranding the revision.

**Enforcement points.**
- *Submit (#1/#2):* validate ≥1 *eligible* reviewer / approver after excluding the
  submitter; 409 with a clear message otherwise.
- *Endorse / sign / reject / request-changes:* `403` if `current_user.id ==
  revision.created_by` — generic message ("You can't approve a revision you submitted").
- *Approval counting:* `_all_required_have_signed` computes over (required − creator).

---

## 7. RBAC changes

- **New helper `assert_can_review(project_id, user, db)`** — passes for admin or a member
  with role `reviewer`. Used by the endorse / review-request-changes endpoints. (Open
  decision §15.4: should `approver` also be allowed to endorse review?)
- **Approval path keeps `assert_can_sign`** but every sign/reject/request-changes endpoint
  adds the §6 creator-exclusion guard.
- **Recommended companion tightening (opt-in, flagged):** today `assert_can_sign` admits
  *any* non-viewer member, so a planner can record a non-binding "noise" signature.
  Consider tightening binding signatures to *approval authority only* (designated
  email-approver **or** role `approver` **or** admin). This is a behaviour change with
  test impact, so it's called out separately rather than assumed.

All denials stay generic (`403 "Access denied"` / `"Insufficient role for this action"`).

---

## 8. Audit events

Add governance events (append-only, via `governance_event`) for: `submitted_for_review`,
`submitted_for_approval` (with `review_skipped` flag in detail), `review_endorsed`,
`review_completed`, `review_changes_requested`, and `review_policy_changed`. The existing
`signed` / `approved` / `rejected` / `changes_requested` / `discarded` events are
retained. Nothing in the audit log gains an update/delete path.

---

## 9. Data model changes

| Entity | Change | Notes |
|---|---|---|
| `Project` | `+ review_policy: str` default `"optional"` | allow-list validated in the Pydantic schema (`required`/`optional`/`off`) |
| `Revision` | `+ review_required: bool` default `False` | the resolved route; drives initial status + the `review_skipped` badge |
| `ReviewEndorsement` | new table | `revision_id`, `user_id`, `endorsed_at`, optional `note` |
| `Revision.status` | new value `"pending_review"` | **no migration of the column** — it's already `String(32)` |

Reuse `decision_reason` / `decision_by` / `decision_at` for review request-changes (same
columns the approval decline already uses).

---

## 10. API surface (sketch)

```
PATCH  /api/projects/{id}                         # set review_policy (planner)
POST   /api/projects/{id}/revisions               # submit; body adds request_review?: bool
POST   /api/projects/{id}/revisions/{rid}/endorse           # reviewer endorses (advances when rule met)
POST   /api/projects/{id}/revisions/{rid}/review-changes    # reviewer requests changes (reason required)
POST   /api/projects/{id}/revisions/{rid}/sign              # approver signs (existing; + §6 guard)
POST   /api/projects/{id}/revisions/{rid}/reject            # existing; + §6 guard
POST   /api/projects/{id}/revisions/{rid}/request-changes   # existing; + §6 guard
```

`RevisionResponse` gains: `review_required`, `review_skipped`, `review_endorsements[]`
(name + time), and a `stage` convenience field for the UI.

Pydantic: `request_review` is an optional bool; `review_policy` an allow-listed enum;
review request-changes `reason` reuses the 1–2000-char bound (empty → 422).

---

## 11. Frontend changes

- **Submit dialog:** when `review_policy = optional`, a route toggle ("Send for technical
  review first" vs "Submit straight to approval"); hidden/forced for `required` / `off`.
- **Revision detail / approval view:** render the new `pending_review` stage; an
  endorsements panel (mirroring the signatures panel); the `review_skipped` badge; and
  reviewer actions (Endorse / Request changes) gated by role.
- **Status chips:** add "in review"; keep existing chips.
- **Project settings:** a `review_policy` selector (planner-only).

---

## 12. Edge cases & failure modes

- **No eligible reviewer/approver after §6 exclusion** → block at submit (see §6).
- **Reviewer requests changes after another already endorsed** → still allowed while
  `pending_review`; the revision goes to `changes_requested` and unlocks.
- **Policy changed mid-flight** (e.g. `optional → off`) → does not retroactively move an
  already-open revision; applies to the next submission.
- **Concurrent endorsements** → idempotent per user (one endorsement per reviewer per
  revision, like the existing one-signature-per-user rule); advancing is guarded on the
  current status so a double-advance is a no-op.
- **Admin acting on own submission** → blocked by §6 (integrity over bypass).
- **Backward compatibility** → existing revisions have `review_required=false`,
  `review_policy` defaults to `optional`; nothing in history is rewritten.

---

## 13. Migration & MSSQL portability

- `Revision.status` needs **no** column migration (free string).
- Add `Project.review_policy` (string + app-level allow-list, not a DB enum — portable),
  `Revision.review_required` (boolean, default false / 0), and create `ReviewEndorsement`.
- Use `sa.func.now()` (never `sa.text("now()")`) for any server default; no Postgres-only
  `DROP TYPE`. Follow the dialect-portability rules already established in migrations.

---

## 14. Phasing (logical commits, each green before the next)

1. **Model + state machine + policy** — `review_policy`, `review_required`,
   `ReviewEndorsement`, the `pending_review` status, migration, snapshot/lock unchanged.
2. **RBAC + endpoints + audit** — `assert_can_review`, endorse / review-changes
   endpoints, §6 guards on submit + all decision endpoints, audit events, **denial tests**
   (non-reviewer endorsing, creator approving own, skipped-review visibility, empty
   eligible set).
3. **Frontend** — submit route toggle, review stage + endorsements panel, badges, policy
   selector.
4. **Docs** — update `CLAUDE.md` (workflow rules + the §6 rule), `rbac-reference.md`
   (reviewer now distinct; SoD), and `user-guide.md`.

---

## 15. Open decisions (recommended default in **bold**)

1. **Reviewer set:** **role-based pool (members with role `reviewer`)** vs a named
   `ProjectReviewer` email matrix (discipline-specific concurrence).
2. **Completion rule:** **≥1 reviewer endorses** vs all reviewers vs a quorum.
3. **Default `review_policy`:** **`optional`** (planner chooses) vs `required`.
4. **Can `approver` also endorse review?** **No (keep stages clean)** vs yes (a GM may
   pre-endorse).
5. **Adopt the §7 sign-tightening** (only approval-authority may cast a binding
   signature)? **Recommended yes**, but it's a behaviour change — confirm before building.

---

## 16. Out of scope (for now)

- Internal-domain validation of approver/reviewer emails (a separate hardening).
- Per-discipline named reviewer matrices (decision §15.1 can pull this in later).
- Parallel multi-stage approvals beyond review → approval.
