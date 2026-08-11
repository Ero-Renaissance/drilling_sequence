# Drilling Sequence Planner — IT Demand Request: Business Case

**Date:** July 2026
**Sponsor:** [name / department — Wells Planning]
**Application:** Drilling Sequence Planner v2.0 (internal web application — built, tested, in pilot use)
**Companion documents:** [`it-engagement-overview.html`](it-engagement-overview.html) (how it works, for IT), [`deployment-guide.md`](deployment-guide.md), [`rbac-reference.md`](rbac-reference.md), [`user-guide.md`](user-guide.md), `PRD.md` (repo root)

---

## 1. Executive summary

The drilling and workover sequence — the plan that commits our rig fleet, wells and
budget for years ahead — is today maintained in Excel and approved by circulating
files. The Drilling Sequence Planner replaces that with a governed system of record:
a live rig-sequence chart with per-well readiness gates and contract-expiry alerts,
a two-stage digital review→approval workflow with immutable signed snapshots and an
append-only audit trail, and a rig-fleet optimizer for capacity decisions.

**The application is already built and verified** (FastAPI/React/PostgreSQL, Windows
Integrated Auth SSO, 500+ automated tests). **This demand asks IT to onboard it**:
production hosting behind an IIS reverse proxy that provides Windows sign-in, a managed
database, backup, and a support arrangement. The infrastructure footprint is one small
app service and one database; there are no licence or per-seat costs.

---

## 2. Problem statement

The current process is a planner-maintained spreadsheet, emailed for review and
approved on printouts. A structured audit of the live schedule workbook during the
July 2026 data-migration exercise found — in one file:

| Finding | Scale | Consequence |
|---|---|---|
| Ambiguous rig identity: the sheet could not say which physical rig a row meant | **93 apparent double-bookings, of which only 19 were real** — the other 74 were two different rigs sharing one name (a land unit and a swamp unit both called "10K Rig 1"); 7 names silently covered 14 physical rigs | Nobody could tell a genuine conflict from a phantom one without days of forensic analysis. Real double-bookings hid in the noise; false ones would have triggered needless replanning |
| Genuine rig double-bookings (one rig, one terrain, overlapping wells) | **19 overlapping pairs**, incl. six well-pairs booked into identical windows on one swamp rig | The plan promised dates a single rig could not deliver; honest resequencing moved the affected lines by up to +49 days |
| Invalid calendar dates (e.g. "30 Feb 2028") | 14 cells | Excel accepts them; every downstream system and calculation silently misreads or fails |
| Contradictory rig contract expiry dates (formula artifacts) | 10–24 different "expiry" values **per rig name** — and where one name covers two physical rigs, one date for two contracts | No reliable warning of a contract lapsing under an active campaign |
| Multiple wells compressed into one cell ("KOCR 9 21 17 28 5 (5 WELLS)") | ~20 campaign lines, up to 26 wells each | Per-well readiness, well counts, and progress tracking impossible; labels contradicted their own counts (one said 26 wells, listed 24) |
| One physical fleet fragmented across spelling variants | 28 rig-name spellings for a fleet that structured analysis puts at ~30+ physical units | Utilisation, conflicts and contracts split across phantom rigs — or merged across real ones |
| No record of who changed or approved what | — | Approval evidence lives in inboxes; no defensible trail for JV partners or audit |

None of this reflects on the planner — it is what unstructured tooling does to a
dataset of this complexity. The point is that **Excel cannot refuse a wrong plan**,
and this plan commits rig spread rates measured in tens of thousands of dollars per
day.

---

## 3. Proposed solution (already delivered)

A browser-based internal application, silent single sign-on via the user's Windows domain account:

- **Living rig sequence** — Gantt of every rig/HWU line with per-well readiness
  gates (FDP, LLI, LOC, FE, FID, EIA, BUD), flood-risk flags, and contract-expiry
  badges; filter by project, terrain, or campaign.
- **Validation at the door** — imports and edits are checked server-side: real
  dates, canonical activity types and readiness codes, one contract per rig. The
  failure modes in §2 are rejected or flagged at entry, not discovered in operations.
- **Conflict enforcement** — a plan with two activities overlapping on one rig
  **cannot be submitted for approval**. Double-booking is now a hard error, not a
  hidden assumption.
- **Governed approvals** — two-stage review → approval with designated
  reviewers/approvers, separation of duties (an author cannot approve their own
  revision), plan locking while a revision is pending, an **immutable snapshot** of
  every approved plan, and an append-only audit log of every governance action.
- **Contract early warning** — expiry alerts keyed to the quarterly approval
  cadence: amber at six months (two approval sittings left), orange at three months
  (the current sitting is the last chance to act), red when lapsed.
- **Rig-fleet optimizer** — a mathematical (MILP) scheduler that answers "can this
  campaign be delivered with N rigs, and in what sequence?" in minutes.
- **Formal outputs** — a print/PDF rig-sequence document for JV partners with
  document reference, sign-off table and confidentiality footer; Excel export for
  downstream use.

Security posture (detail in the IT engagement overview): Windows Integrated Auth SSO
only (no passwords stored), per-project role-based access with deny-by-default, admin
via an email/username allowlist, production fail-closed startup (refuses to boot with
auth misconfigured), no PII in logs, audit log is append-only.

---

## 4. Expected value

Rates below are indicative industry ranges — replace the bracketed figures with
contracted rates before submission.

| Value driver | Mechanism | Basis of estimate |
|---|---|---|
| **Avoided idle/standby rig time** | Double-bookings blocked at approval instead of surfacing in operations — and phantom conflicts (two rigs sharing a name) never raised at all | 19 genuine double-bookings existed in the current plan, hidden among 74 false positives that only structured rig identity could separate. One genuine conflict reaching operations idles a rig or forces emergency resequencing; at a land/swamp spread rate of **[$30k–$100k/day]**, a single avoided idle week is **[$0.2M–$0.7M]**. Preventing even one or two such events per year exceeds the cost-to-serve by orders of magnitude |
| **Contract continuity** | Six-month lapse warning aligned to approval sittings | Avoids emergency extensions and standby premiums negotiated under time pressure, or demobilisation/remobilisation of a rig mid-campaign (**[$1M–$5M]** per event, per industry experience) |
| **Honest schedule commitments** | The plan can no longer assume >100% rig capacity | Business decisions (production forecasts, budget phasing, JV commitments) stop being made against dates that were arithmetically impossible |
| **Approval cycle time** | Same-day digital sign-off with automatic routing, versus multi-day email/print circulation | Planner and approver hours per revision **[X hrs → Y hrs]**; more revisions per quarter become practical, so the approved plan tracks reality more closely |
| **Planning effort** | No re-drawing of charts per revision; imports validated instead of manually cleansed | The one-off migration consumed days of expert cleanup; the application makes that recurring cost zero at source |
| **Readiness compliance** | Per-well gate tracking with statuses visible on the chart | Reduces spud-without-approvals rework and strengthens the well-delivery assurance story to the regulator |
| **Fleet capacity decisions** | Optimizer evaluates rig-count scenarios in minutes | Releasing or not hiring one rig for one year is **[$10M–$35M]** of spread cost — the optimizer makes that question answerable with evidence |
| **Audit and JV defensibility** | Immutable approved snapshots + append-only governance log | A complete, timestamped record of what was approved, by whom, and what changed since — available on demand for JV partners and audits |

Even under conservative assumptions, the value case is carried entirely by the
first row: the application costs a small app service and a database; a **single
avoided idle rig-week pays for years of hosting**.

---

## 5. Risk of not performing (do nothing)

| # | Risk | Evidence / likelihood | Consequence |
|---|---|---|---|
| 1 | Double-booked rigs reach operations | **Observed**: 19 genuine overlapping pairs in the current plan — invisible among 74 phantom ones | Idle day-rate burn, emergency resequencing, well slippage cascading through the campaign |
| 2 | Rig contract lapses under an active campaign | **Observed**: no rig had one trustworthy expiry date; 7 rig names carry ONE contract date for TWO physical rigs | Standby/renegotiation premium, potential demob of a contracted rig, schedule gap |
| 3 | Nobody can say which physical rig a plan line means | **Observed**: 7 names each covered a land unit and a swamp/offshore unit; conflicts, contracts and utilisation were computed against the wrong fleet | Real conflicts dismissed as noise, phantom conflicts triggering needless replanning, and commitments anchored to a fleet model that doesn't match the iron |
| 4 | Unauditable approvals | Standing condition of the email/print process | Governance findings; disputes with JV partners about which plan version was approved and when |
| 5 | Key-person and single-file risk | The plan is one workbook on one laptop | Corruption, accidental overwrite or the planner's absence stalls the entire planning process; no access control, no history, no recovery |
| 6 | Recurring silent data decay | **Observed**: every failure class in §2 accumulated organically | Each planning cycle re-pays the cleanup cost — or worse, doesn't, and plans on bad data |
| 7 | Unsupported tooling | The application exists and is in pilot use | Without IT onboarding it either runs outside managed infrastructure (unpatched, unmonitored, un-backed-up) or the organisation falls back to items 1–6 |

Items 1–3 are not hypothetical: they were all present in the live schedule at the
time of the July 2026 audit, and items 1 and 3 are now structurally impossible in
the application.

---

## 6. The ask from IT

| Item | Detail |
|---|---|
| Hosting | One small Windows Server / VM with IIS (IIS provides Windows sign-in and TLS, and reverse-proxies to uvicorn — see deployment guide) |
| Database | Managed PostgreSQL (MSSQL also supported — migration guide exists) with scheduled backups |
| Identity | Windows Integrated Auth at the IIS reverse proxy (Kerberos/NTLM) — no app registration; the app's URL added to the Local Intranet zone (GPO) for silent sign-on; admins listed by email/username |
| Security review | Codebase available for review; RBAC reference, threat-relevant design notes and 500+ automated tests (321 backend / 211 frontend) provided |
| Monitoring | Log shipping to the standard sink (Azure App Insights proposed); health endpoint available |
| Support model | L1 via [service desk]; product/maintainer support via Wells Planning ([maintainer-guide.md](maintainer-guide.md), [smoke-test-runbook.md](smoke-test-runbook.md) provided) |

**Costs:** no licences, no per-seat fees; open-source stack under permissive
licences. Indicative run cost: **[$150–$400/month]** infrastructure plus initial IT
effort of **[3–5 days]** (IIS Windows-Auth setup, pipeline, security review). Development
cost is already sunk.

---

## 7. Success measures

- Zero same-rig date overlaps in any approved plan (enforced; measure = conflicts caught pre-approval).
- 100% of campaign approvals carry a digital audit trail and immutable snapshot.
- Approval cycle time (submit → fully signed): baseline vs. target **[X days → same-day]**.
- Every in-force rig contract acknowledged (extended or replanned) ≥ one approval sitting before expiry.
- Per-well readiness completeness across the active campaign ≥ **[target %]**.

## 8. Delivery risks and mitigations

| Risk | Mitigation |
|---|---|
| Planner adoption | The workflow keeps Excel as an input (validated import) and print/wet-ink as an approval fallback; the pilot migration of the live schedule is already complete |
| Single maintainer | Full documentation set (user, maintainer, deployment, runbook), 500+ automated tests, conventional stack (FastAPI/React) hireable in-market |
| Data migration quality | Already performed and verified for the current campaign; import validation prevents regression |

---

*Prepared by Wells Planning. Figures in [brackets] to be confirmed with contracted
rates before submission.*
