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
| reviewer | Casts a **review signature** or requests-changes **at the review stage**. Cannot terminally reject; a review signature *advances* the revision rather than finalising it. The *required* reviewers are a designated email matrix (§5), mirroring approvers — the role is for participation/visibility, not the binding gate. |
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
| 3 | `pending_review` → `pending_approval` | review complete (last required review signature lands, §5) | all designated reviewers signed | audit `review_completed` |
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

## 5. Who reviews, and when review is "complete" — *decided*

Review mirrors approval exactly, one stage earlier:

- **Reviewer set = a designated email matrix**, managed just like approvers — *not*
  membership roles, *not* a discipline-typed matrix. Reviewers may be internal company
  people who aren't project members, matched by lowercased email.
- **Completion rule = ALL designated reviewers must sign.** Only when every required
  reviewer (minus the creator, §6) has a review signature does the revision advance to
  `pending_approval`. There is no partial-quorum advance (the strictest setting — keep
  reviewer lists short; a reviewer who objects uses request-changes to bounce it).
- **Reviewers cast real signatures**, recorded in the existing `Signature` table with a
  new `stage` discriminator (`"review"` vs `"approval"`). A review signature is a formal
  signed concurrence, but it *advances* rather than *finalises*, and reviewers still
  can't terminally reject.

**Implementation (symmetry over duplication):**
- Generalise the existing approver entity with a `kind` column (`reviewer`/`approver`)
  rather than copying the email-matching + list-management code into a parallel table.
  Existing rows default to `kind="approver"`.
- Add `Signature.stage` (`review`/`approval`, default `approval`). `_all_required_have_signed`
  filters to `stage="approval"`; a symmetric `_all_reviewers_have_signed` filters to
  `stage="review"` against the reviewer email set. A review signature can therefore never
  be miscounted as an approval.
- **Each stage's signing is gated to its own designated email set (+ admin).** Only a
  designated reviewer signs the review; only a designated approver signs the approval.
  This also resolves the old "noise signature" problem by construction (§7).

---

## 6. Separation of duties — nobody approves their own plan

**Rule.** The user recorded as a revision's `created_by` may **not**, on that revision:
cast a review signature, cast an approval signature, reject it, or
request-changes-as-approver. They *may* discard it (it's their own draft).

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
- *Sign-review / sign / reject / request-changes:* `403` if `current_user.id ==
  revision.created_by` — generic message ("You can't approve a revision you submitted").
- *Signature counting:* both `_all_reviewers_have_signed` and
  `_all_required_have_signed` compute over (required − creator).

---

## 7. RBAC changes

- **New helper `assert_can_review(project_id, user, db)`** — passes for admin or a
  **designated reviewer** (by lowercased email), mirroring how `assert_can_sign` treats
  designated approvers. Used by the sign-review / review-request-changes endpoints.
- **`assert_can_view` extends to designated reviewers** (by email), so a reviewer who
  isn't a project member can still see the diff they're asked to concur on — exactly as
  it already does for approvers.
- **Tightening, now decided (was §15.5):** signing is gated to the designated email set
  for its stage (+ admin). Only a designated **reviewer** may sign the review; only a
  designated **approver** may sign the approval. This removes the current "any non-viewer
  member can record a noise signature" behaviour — a deliberate behaviour change, covered
  by new denial tests. `assert_can_sign` is narrowed accordingly (admin **or** designated
  approver), and every sign/reject/request-changes endpoint also adds the §6
  creator-exclusion guard.

All denials stay generic (`403 "Access denied"` / `"Insufficient role for this action"`).

---

## 8. Audit events

Add governance events (append-only, via `governance_event`) for: `submitted_for_review`,
`submitted_for_approval` (with `review_skipped` flag in detail), `review_signed`,
`review_completed`, `review_changes_requested`, and `review_policy_changed`. The existing
`signed` / `approved` / `rejected` / `changes_requested` / `discarded` events are
retained. Nothing in the audit log gains an update/delete path.

---

## 9. Data model changes

| Entity | Change | Notes |
|---|---|---|
| `Project` | `+ review_policy: str` default `"optional"` | allow-list validated in the Pydantic schema (`required`/`optional`/`off`) |
| `Revision` | `+ review_required: bool` default `False` | the resolved route; drives initial status + the `review_skipped` badge |
| `ProjectApprover` | `+ kind: str` default `"approver"` | generalised to designated *signers*; `reviewer` rows are the review matrix. Existing rows backfill to `approver`. Email management endpoints parametrise on `kind`. |
| `Signature` | `+ stage: str` default `"approval"` | `review`/`approval`; lets one table hold both, filtered when counting (§5) |
| `Revision.status` | new value `"pending_review"` | **no migration of the column** — it's already `String(32)` |

Reuse `decision_reason` / `decision_by` / `decision_at` for review request-changes (same
columns the approval decline already uses). No separate endorsement table — a review
concurrence *is* a `Signature` with `stage="review"`.

---

## 10. API surface (sketch)

```
PATCH  /api/projects/{id}                         # set review_policy (planner)
GET/POST/DELETE /api/projects/{id}/reviewers      # manage the reviewer email matrix (planner) — mirrors /approvers
POST   /api/projects/{id}/revisions               # submit; body adds request_review?: bool
POST   /api/projects/{id}/revisions/{rid}/sign-review       # reviewer signs (advances when all reviewers signed)
POST   /api/projects/{id}/revisions/{rid}/review-changes    # reviewer requests changes (reason required)
POST   /api/projects/{id}/revisions/{rid}/sign              # approver signs (existing; + §6 guard)
POST   /api/projects/{id}/revisions/{rid}/reject            # existing; + §6 guard
POST   /api/projects/{id}/revisions/{rid}/request-changes   # existing; + §6 guard
```

`RevisionResponse` gains: `review_required`, `review_skipped`, `reviewer_status[]`
(per-reviewer signed/not, mirroring `approver_status`), and a `stage` convenience field
for the UI. The reviewer-list endpoints mirror the existing approver-list endpoints in
`app/routers/approvers.py`, parametrised on `kind="reviewer"`.

Pydantic: `request_review` is an optional bool; `review_policy` an allow-listed enum;
review request-changes `reason` reuses the 1–2000-char bound (empty → 422).

---

## 11. Frontend changes

- **Submit dialog:** when `review_policy = optional`, a route toggle ("Send for technical
  review first" vs "Submit straight to approval"); hidden/forced for `required` / `off`.
- **Revision detail / approval view:** render the new `pending_review` stage; an
  review-signatures panel (mirroring the approval signatures panel); the `review_skipped`
  badge; and reviewer actions (Sign review / Request changes) gated by designation.
- **Status chips:** add "in review"; keep existing chips.
- **Project settings:** a `review_policy` selector (planner-only).

---

## 12. Edge cases & failure modes

- **No eligible reviewer/approver after §6 exclusion** → block at submit (see §6).
- **Reviewer requests changes after another already signed** → still allowed while
  `pending_review`; the revision goes to `changes_requested` and unlocks.
- **Policy changed mid-flight** (e.g. `optional → off`) → does not retroactively move an
  already-open revision; applies to the next submission.
- **Concurrent review signatures** → idempotent per user (one review signature per
  reviewer per revision, like the existing one-signature-per-user rule); advancing is
  guarded on the current status so a double-advance is a no-op.
- **Admin acting on own submission** → blocked by §6 (integrity over bypass).
- **Backward compatibility** → existing revisions have `review_required=false`,
  `review_policy` defaults to `optional`; nothing in history is rewritten.

---

## 13. Migration & MSSQL portability

- `Revision.status` needs **no** column migration (free string).
- Add `Project.review_policy` (string + app-level allow-list, not a DB enum — portable),
  `Revision.review_required` (boolean, default false / 0), `ProjectApprover.kind`
  (string default `"approver"`, backfill existing rows), and `Signature.stage` (string
  default `"approval"`).
- Use `sa.func.now()` (never `sa.text("now()")`) for any server default; no Postgres-only
  `DROP TYPE`. Follow the dialect-portability rules already established in migrations.

---

## 14. Phasing (logical commits, each green before the next)

1. **Model + state machine + policy** — `review_policy`, `review_required`,
   `ProjectApprover.kind`, `Signature.stage`, the `pending_review` status, migration,
   snapshot/lock unchanged.
2. **RBAC + endpoints + audit** — `assert_can_review`, reviewer-list management,
   sign-review / review-changes endpoints, narrowed `assert_can_sign`, §6 guards on
   submit + all decision endpoints, audit events, **denial tests** (non-reviewer signing
   review, creator approving own, skipped-review visibility, empty eligible set).
3. **Frontend** — submit route toggle, review stage + review-signatures panel, badges,
   reviewer-list + policy settings.
4. **Docs** — update `CLAUDE.md` (workflow rules + the §6 rule), `rbac-reference.md`
   (reviewer now distinct; SoD), and `user-guide.md`.

---

## 15. Decisions

**Settled:**
1. **Reviewer set:** a designated **email matrix**, managed like approvers (generalised
   `ProjectApprover.kind`). Not roles, not disciplines.
2. **Completion rule:** **all designated reviewers must sign** (no partial quorum).
3. **Reviewers cast real signatures** (`Signature.stage="review"`).
4. **Default `review_policy` = `optional`** (planner chooses per revision; a governance
   owner can still set `required` or `off` per project).
5. **Sign-tightening adopted:** only the designated email set for a stage (+ admin) may
   sign it; this narrows `assert_can_sign`.
7. **Reviewer powers = request-changes only.** A reviewer signs (concur) or requests
   changes (bounce back); the terminal `rejected` decision stays with approvers (the GMs).

**Still open (recommended default in bold):**
6. **Confirm the conceptual framing:** reviewer and approver are now mechanically the
   same (email matrix, all must sign); the only differences are *order* (review first),
   *bindingness* (review advances, approval finalises), and *no terminal reject for
   reviewers*. **Confirm that "sequence + non-binding" is the intended distinction** — if
   so, the `reviewer`/`approver` membership roles are vestigial labels (the matrices carry
   the authority), which is fine and matches how the `approver` role already behaves.

---

## 16. Out of scope (for now)

- Internal-domain validation of approver/reviewer emails (a separate hardening).
- Per-discipline named reviewer matrices (decision §15.1 can pull this in later).
- Parallel multi-stage approvals beyond review → approval.
