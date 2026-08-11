# Drilling Sequence — Maintainer Guide

For the developer who inherits or extends this codebase. Read this once end-to-end,
then keep [`CLAUDE.md`](../CLAUDE.md) open — **that file is the binding source of
truth for the security and business rules; this guide explains the "how".**

---

## 1. Mental model in one paragraph

Drilling Sequence is an internal **system of record** for an oil & gas rig schedule
and its **formal approvals**. Because it's a system of record, the priorities are
(in order): **correct access control, auditability, data integrity** — then
features. A FastAPI + async SQLAlchemy backend exposes a JSON API under `/api`; a
React/TypeScript SPA consumes it. Identity is the Windows domain, via a reverse
proxy that does Integrated Auth (the app was migrated off Azure AD). The production
database is Microsoft SQL Server; tests and local dev use SQLite. When in
doubt about a trade-off, choose the more defensible/auditable option.

---

## 2. Repository layout

```
drilling_sequence/
├─ CLAUDE.md                 # THE RULES — read this. Security + business logic.
├─ docker-compose.yml        # LOCAL DEV ONLY (Postgres + dev_mode, hot reload).
├─ .githooks/pre-push        # The local gate: typecheck + both suites + ruff.
│                            # Enable once: git config core.hooksPath .githooks
├─ .github/workflows/ci.yml  # Post-push tripwire re-running the same checks.
├─ docs/
│   ├─ deployment-guide.md   # How to deploy on the internal server.
│   ├─ user-guide.md         # End-user guide.
│   ├─ maintainer-guide.md   # (this file)
│   ├─ rbac-reference.md     # Access model as enforced (roles, helpers, approvers).
│   ├─ review-approval-workflow-spec.md  # Two-stage endorse→approve model.
│   ├─ rig-optimization-spec.md          # Optimizer feature spec (+ engines).
│   ├─ rig-registry-spec.md              # Fleet registry / planned slots.
│   ├─ project-dashboard-spec.md         # Overview KPI definitions.
│   └─ mssql-migration.md    # DB decision + Postgres→MSSQL notes.
├─ backend/
│   ├─ app/
│   │   ├─ main.py           # FastAPI app, lifespan, middleware, /api/health.
│   │   ├─ config.py         # Settings (env vars) + production fail-closed guard.
│   │   ├─ database.py       # Async engine + session; SQLite vs server-DB handling.
│   │   ├─ core/
│   │   │   ├─ auth.py       # Proxy-header (Windows Auth) identity; get_current_user; dev bypass.
│   │   │   ├─ rbac.py       # assert_member / assert_can_sign / assert_can_review
│   │   │   │                # / assert_can_plan — USE THESE.
│   │   │   ├─ locks.py      # Plan-lock helpers (HTTP 423).
│   │   │   └─ logging_config.py  # Structured logging + request correlation.
│   │   ├─ models/           # SQLAlchemy ORM models (the schema).
│   │   ├─ schemas/          # Pydantic v2 request/response models (validation).
│   │   ├─ routers/          # API endpoints, one module per resource.
│   │   └─ services/         # Domain logic: audit, conflicts, snapshot,
│   │                        # revision_diff, email, data_processor, dashboard,
│   │                        # readiness, registry, integrity, spreadsheet,
│   │                        # activity_types, rig_optimizer(+_milp).
│   ├─ alembic/              # Migrations (versions/) + env.py.
│   ├─ tests/                # pytest suite (runs on in-memory SQLite).
│   ├─ pyproject.toml        # Direct deps (pinned exact) + tooling config.
│   ├─ requirements.txt      # The lockfile (full pinned tree; consumed by Docker).
│   └─ Dockerfile            # Backend image (installs MSSQL ODBC Driver 18).
└─ frontend/
    └─ src/
        ├─ main.tsx, App.tsx # Entry + router.
        ├─ api/              # One module per backend resource (fetch wrappers).
        ├─ pages/            # Route-level screens (Dashboard, ProjectDetail,
        │                    # RigOptimizer, ...).
        ├─ components/       # Reusable UI (chart/, layout/, dashboard/, grids).
        ├─ lib/              # Pure helpers (conflicts, chart-utils, capacity).
        ├─ store/            # zustand stores (theme, auth, ...).
        ├─ types/            # Shared TS types.
        └─ test/             # vitest + Testing Library specs.
```

---

## 3. Tech stack

- **Backend:** Python 3.11, FastAPI, SQLAlchemy 2.0 (async), Pydantic v2, Alembic.
  ASGI server: uvicorn.
- **Frontend:** React 18, TypeScript, Vite, Tailwind, Radix UI, zustand, ECharts
  (`echarts-for-react`), React Router v7.
- **DB:** MSSQL in prod (via `aioodbc`/`pyodbc` + ODBC Driver 18); SQLite
  (`aiosqlite`) for dev/tests. Postgres (`asyncpg`) retained through the MSSQL
  transition only — see `mssql-migration.md`.
- **Auth:** Windows Integrated Auth at the reverse proxy (IIS), which injects the
  signed-in user into a trusted header the backend reads. No tokens on the frontend.

---

## 4. Local development setup

### Backend
```bash
cd backend
python3.11 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"           # installs runtime + dev (pytest, ruff, aiosqlite)
printf 'DEV_MODE=true\nDATABASE_URL=sqlite+aiosqlite:///./drilling_sequence.db\n' > .env
uvicorn app.main:app --reload     # http://localhost:8000  (docs at /api/docs)
```

The two `.env` lines above are all local dev needs. The canonical settings list
is `backend/app/config.py` (every field reads the matching env var); production
values are documented in the deployment guide §4a.
In dev (`DEV_MODE=true`) authentication is bypassed and a fake **Dev User** (admin) is
injected, so you can work without the proxy. SQLite tables are auto-created on startup
(`main.py` lifespan) — no migrations needed locally.

### Frontend
```bash
cd frontend
npm install
printf 'VITE_DEV_MODE=true\n' > .env.local
npm run dev                        # http://localhost:5173
```
The dev server proxies/serves the SPA; it calls the backend at `/api` (run the
backend too). Login shows **"Continue as Dev User"** in dev mode.

### Or both via Docker (dev only)
`docker compose up` brings up Postgres + backend + frontend with hot reload. This
compose is **not** a production setup.

---

## 5. Quality gates — run these before every commit/PR

| | Command (from the package dir) | What it checks |
|---|---|---|
| Backend tests | `pytest -q` | 400+ tests, on in-memory SQLite. |
| Backend lint | `ruff check app/ alembic/` | style + imports (`E`, `F`, `I`). |
| Frontend types | `npm run lint` (`tsc -b`) | TypeScript type errors. |
| Frontend tests | `npm test` (`vitest run`) | component + lib unit tests. |

These run automatically at two layers:

- **The gate — `.githooks/pre-push`** runs all four before any push and refuses a
  broken tree. It's per-clone opt-in; enable it once after cloning:
  `git config core.hooksPath .githooks` (emergency bypass: `git push --no-verify`).
- **The tripwire — `.github/workflows/ci.yml`** re-runs the same checks in a clean
  environment on every push to `main`, catching `--no-verify` pushes and
  works-on-my-machine breakage. Direct-to-main means it runs *after* the push —
  the hook is the gate, CI is the backstop.

---

## 6. Backend architecture & conventions

**Request lifecycle:** `routers/*` define endpoints → depend on `get_current_user`
(auth) and `get_db` (session) → call `core/rbac.py` to authorize → validate input
with a `schemas/*` Pydantic model → do work via the ORM / a `services/*` function →
return a Pydantic response model.

**The non-negotiables (enforced in code review):**
1. **Authorize at the top of every endpoint** using the shared helpers — never
   re-implement the check:
   - `assert_member(project_id, user, db, allowed_roles={...})` — gate by project
     membership / role. Planner-only actions pass `allowed_roles={ProjectRole.planner}`.
   - `assert_can_sign(project_id, user, db)` — for signing/approval actions.
   - A **global admin bypasses** per-project checks — preserve that bypass.
   - Default deny. Scope every object lookup to the caller's allowed projects (no BOLA).
2. **Validate all input server-side** with Pydantic v2 schemas: strict types,
   enums/allow-lists (roles, plan types, readiness codes), explicit bounds (decision
   reasons 1–2000 chars). Never trust a value because the frontend also checks it.
3. **No raw SQL.** ORM / Core `select()` with bound params only. No f-string SQL, no
   `text()` with interpolation.
4. **Emit governance audit events** for anything governance-relevant
   (sign/approve/reject/discard, approver add/remove, project create/clone) via
   `services/audit.py::governance_event`. The audit log is **append-only** — never
   expose update/delete on it.
5. **Fail securely.** Raise `HTTPException` with generic messages ("Access denied").
   Never leak SQL/stack traces/IDs/existence to unauthorized callers — log detail
   server-side. Side-effects that must not break the request (email/SMTP,
   notifications) are **fire-and-forget** and must never raise into the response.
6. **Production fails closed** (`config.py`): with `ENVIRONMENT=production`, the app
   refuses to start if `dev_mode=True` or `proxy_user_header` is missing. Never weaken this.

**Key services:**
- `conflicts.py` — rig double-booking detection (same rig, overlapping non-completed
  dates). Enforced server-side to hard-block submitting an impossible plan (HTTP 409).
- `snapshot.py` / `revision_diff.py` — a revision freezes the plan as `snapshot_json`
  (a JSON **array** of activity dicts — keep it an array); diffs compare snapshots.
- `locks.py` — while a revision is pending approval, activities/readiness/contracts
  are locked (HTTP 423).

---

## 7. Frontend architecture & conventions

**Data flow:** `pages/*` (route screens) compose `components/*` and call `api/*`
wrappers (thin `fetch` around `/api/...` — **relative URLs**, same-origin). Cross-
cutting UI state (theme, auth) lives in `store/*` (zustand). Pure logic with no React
(date math, conflict detection, colour maps) lives in `lib/*` and is unit-tested
directly.

Conventions:
- **Output encoding / XSS:** rely on React's JSX escaping. Never
  `dangerouslySetInnerHTML` with user data. The HTML/PDF chart export is the one
  hand-built-HTML surface — contextually encode any user/well/rig/comment text there.
- **API base URL:** there is none — calls are relative `/api/...`, so the app *must*
  be served same-origin as the backend (the reverse proxy does this in prod).
- **Frontend has no auth config:** the browser is authenticated by the proxy, so the
  SPA carries no tokens and there are no auth `VITE_*` vars. `getAccessToken()` in
  `lib/auth.ts` returns null; the API layer just omits the Authorization header.
- Keep `lib/` and the backend in sync where logic is duplicated (e.g. rig-conflict
  detection exists in both `lib/conflicts.ts` and `services/conflicts.py` — change
  both, and both have tests).

---

## 8. Recipe: add a feature end-to-end

Example — a new field/endpoint on a resource:

**Backend**
1. **Model:** add the column in `app/models/<resource>.py`. Use portable types
   (`Mapped[...]`, explicit `String(n)` lengths, `func.now()` for timestamps —
   never literal `text("now()")`, it breaks on MSSQL).
2. **Migration:** `alembic revision --autogenerate -m "add X"`. Review the generated
   file: keep it dialect-portable (see §9). Apply with `alembic upgrade head`.
3. **Schema:** add/extend the `app/schemas/<resource>.py` Pydantic models — validate
   with enums/bounds. Response models stay permissive `str` for legacy rows where the
   existing code does so.
4. **Router:** add the endpoint in `app/routers/<resource>.py`. **First line(s):** an
   `assert_member` / `assert_can_sign` call with the right `allowed_roles`. Then
   validate, do work, return the response model.
5. **Audit:** if the action is governance-relevant, emit a `governance_event`.
6. **Tests:** add to `backend/tests/` — include a **negative/denial test** for any
   new authorization path (viewer/non-member is refused).

**Frontend**
7. **API:** add a wrapper in `src/api/<resource>.ts`.
8. **UI:** add/extend a `components/*` and wire it into the relevant `pages/*`.
9. **Tests:** add a `src/test/*.test.tsx` (or `.test.ts` for `lib/`).

Run all four quality gates (§5) before committing.

---

## 9. Database & migrations

- **Tests don't run migrations** — they build the schema from the models via
  `Base.metadata.create_all` on SQLite. So a migration bug won't fail the test suite;
  review migrations by hand and verify against a real server DB.
- **Migration↔model drift is partly guarded:** `tests/test_migration_model_parity.py`
  replays the migrations offline (no DB — they can't run on SQLite) and fails if a model
  column declares a `server_default` the migration omits. That's the class of bug that
  crashed every write on MSSQL: a `NOT NULL` column with no DB default, which the ORM
  omits from `INSERT` expecting the database to fill it. The test does **not** compare
  column *types/lengths* or *nullability* (those yield false positives on primary keys
  and on dialect-specific type rendering), so review those by hand.
- **Known benign model↔migration inconsistencies** — the deployed DB is wider/looser
  than the model in a few spots. All harmless (every model value fits; no write is
  rejected) and intentionally left as-is — the model lengths were never enforced caps:
  - `audit_logs.old_value` / `new_value`, `activities.comment`, `readiness_checks.notes`
    — model `String(512)`, DB `TEXT`.
  - `audit_logs.field` — model `String(64)`, DB `VARCHAR(128)`.
  - `readiness_checks.check_code` — model `String(16)`, DB `VARCHAR(32)`
    (the column is in a unique constraint but stays bounded, so still indexable).
  - `readiness_checks.updated_at` — model `NOT NULL`, DB nullable (in practice always
    populated by its `server_default`).
- **Portability rules (the app must run on MSSQL and SQLite/Postgres):**
  - Timestamp defaults: `sa.func.now()` (dialect-translated), **not**
    `sa.text("now()")`.
  - `sa.Enum(...)` renders as a native type only on Postgres; on MSSQL/SQLite it's
    `VARCHAR + CHECK`. Guard Postgres-only cleanup (e.g. `DROP TYPE`) with
    `if op.get_bind().dialect.name == "postgresql":`.
  - No dialect-specific DML (no `dialects.sqlite`/`postgresql` `insert`); use portable
    ORM upserts (select-then-insert/update).
- **Apply migrations in prod:** `alembic upgrade head` (run inside the backend
  container — it has the driver). `main.py` only auto-creates tables for SQLite.
- **DB target decision:** MSSQL is the single production DB; the code is kept
  DB-agnostic as insurance, **not** as a maintained dual-DB matrix. See
  `mssql-migration.md`.

---

## 10. Dependencies & supply-chain governance

This app must pass IT security review, so dependencies are treated as liabilities:
- **Pin exact** (`==`) in `pyproject.toml`; the full resolved tree is pinned in
  `requirements.txt` (the lockfile the Docker build installs).
- **Prefer stdlib / already-vetted packages.** Check existing deps before adding one.
- **New deps must be proposed, not silently added:** name, version, permissive
  license (MIT/BSD/Apache-2.0 — flag GPL/AGPL/unknown), no known CVEs, what they pull
  in transitively. Call it out for IT review; don't bury it in an unrelated change.
- **Don't regenerate/bump the whole lockfile** as a side effect. Regenerate
  deliberately (`uv pip compile`, per the header in `requirements.txt`).
- Avoid packages with post-install scripts or binary downloads.

---

## 11. Auth & admin model

- **Auth:** Windows Integrated Auth at the reverse proxy (`core/auth.py`). The proxy
  (IIS) authenticates the user and injects their Windows account into the header named
  by `PROXY_USER_HEADER` (default `X-Remote-User`); the backend trusts it because
  uvicorn is bound to localhost and, optionally, a `PROXY_SHARED_SECRET` (`X-Proxy-Auth`)
  must match. `_extract_claims` parses `DOMAIN\user`/UPN/bare-name → username + email
  (email synthesized from `USER_EMAIL_DOMAIN`). `DEV_MODE=true` injects a dev user and
  is rejected in production. (Migrated off Azure AD — IT doesn't support Azure sign-in.)
- **Roles are per project** (`planner`/`reviewer`/`approver`/`viewer`); the only
  **global** role is `admin`. Roles gate editing/visibility only — sign-off
  authority lives in the email matrices below, not the roles.
- **Campaign creation and planner powers are gated by the admin-curated
  `can_plan` grant** (`assert_can_plan`); everyone else in the org has read-only
  access to everything.
- **Admin is resolved additively at login** — a manual `is_admin` flag, additively
  granted from the `ADMIN_EMAILS` allowlist (matched on the user's email **or** Windows
  username). Never auto-revoke admin from those sources.
- **Designated signers are email-based** (`ProjectApprover`, `kind` = `approver`
  or `reviewer` — two independent required-signature matrices), orthogonal to
  project membership, and may be external to the project. Match by **lowercased**
  email. `assert_can_sign` (approval) / `assert_can_review` (endorsement) admit
  only a global admin or a designated signer of that kind — never a plain member.

---

## 12. Approval workflow rules (don't break these)

Full model: `docs/review-approval-workflow-spec.md`; binding rules: `CLAUDE.md`.
The compressed version:

- **Two stages: review → approval.** UI vocabulary says **Endorse** (Endorsers,
  "Pending endorsement"); code/DB/audit keep `review` (`pending_review`,
  `Signature.stage="review"`, `kind="reviewer"`) — never rename the internals.
  `Project.review_policy` (`required`/`optional`/`off`, default `optional`)
  decides routing at submit; a skipped optional review is flagged
  `review_skipped` (frozen at submit). A review-routed revision advances to
  `pending_approval` only when **all** designated reviewers sign.
- Approval requires **≥1 designated approver AND all signed** — zero approvers
  never auto-approves.
- **Separation of duties (no admin bypass):** the revision's creator may not
  sign, endorse, reject, or request changes on it — only discard. Submit is
  refused (409) when the submitter would be the only eligible signer of a
  required stage.
- Two decline outcomes, both requiring a **non-empty reason (1–2000 chars;
  empty → 422)** and both unlocking the plan: `changes_requested` (either
  stage; the only reviewer decline) and `rejected` (terminal, approval stage
  only).
- **Approval keeps the plan LOCKED** — the approved `snapshot_json` is the
  immutable record. A planner reopens explicitly via **Revise Plan**
  (`POST .../revisions/reopen`, audited `plan_reopened`); next quarter's plan
  is a **clone** of the campaign, never an edit of the approved one.
- **Concurrency is DB-enforced:** a filtered unique index allows one OPEN
  revision per campaign, and every status transition takes a
  `with_for_update()` row lock — keep both when touching the lifecycle.
- Readiness codes (FDP/LLI/LOC/FE/FID/EIA/BUD/CON), plan types, and contract
  semantics are domain enums — validate against the canonical lists, don't accept
  free-form equivalents.

---

## 13. Known gotchas / sharp edges

- **Deploy hygiene:** `backend/.dockerignore` keeps `tests/`, `.venv/`, `.env`, and
  the dev SQLite file out of the image. Docker ignores `.gitignore`, so this file is
  load-bearing — don't delete it.
- **Same-origin `/api`:** the frontend has no API base URL. It only works behind a
  reverse proxy that serves the SPA and proxies `/api`. (Deployment guide §6.)
- **`snapshot_json` is a JSON array**, parsed by `RevisionDetail.tsx` as
  `snapshot.length`. Keep it an array.
- **The activity import template is generated in-app** from a constant in
  `components/chart/ImportDialog.tsx` ("Download a blank template"); the
  human-readable column spec is the table in `docs/user-guide.md`. The canonical
  column names/values come from `backend/app/services/data_processor.py` — keep
  those in sync.
- **ECharts custom series quirks** (in `components/chart/DrillChart.tsx`): a data
  item's own `label` config renders regardless of `series.label.show` — bar labels
  are drawn clip-aware inside `renderItem` instead, and the series sets `clip: true`.
  Zoom is driven through the option's `dataZoom` window (a clean re-render) rather
  than imperative `dispatchAction` to avoid stale leftover elements. The rig-conflict
  indicator is a solid red **stroke** (canvas patterns are unreliable here).
- **The compose/Dockerfiles are dev-shaped.** Production = backend Docker image +
  built frontend `dist/` behind a reverse proxy (deployment guide). The frontend
  Dockerfile runs `npm run dev` — not for prod.
- **Migrations aren't covered by tests** (see §9). Verify them against a server DB.

---

## 14. Security maintenance cadence

Advisories publish continuously — a schedule alone can't flag them "on time".
The model is **event-driven alerts + a light routine**:

- **Continuous (automated):** GitHub **Dependabot alerts + security updates**
  watch both lockfiles (`frontend/package-lock.json`,
  `backend/requirements.txt` + `pyproject.toml`) and raise an alert/PR the day
  an advisory publishes. Repo Settings → *Advanced Security* → enable
  "Dependabot alerts" and "Dependabot security updates".
  `.github/dependabot.yml` additionally opens **monthly, grouped** patch/minor
  update PRs per ecosystem — review them like any change; never merge blind.
- **On alert:** patch highs/criticals immediately — in-range
  `npm audit fix` / pinned-version bump, run the §5 gates, push.
- **Monthly (~20 min):** `npm audit` in `frontend/`; `pip-audit -r
  backend/requirements.txt` (run via `pipx`/`uv tool run` — a dev tool, not an
  app dependency). Apply in-range patches; anything major goes through §10.
- **Quarterly (with the campaign cadence):** review minor bumps of direct deps,
  revisit parked decisions (advisories accepted as not-applicable, pending
  major upgrades, OR-Tools approval), and check the Docker base image + ODBC
  driver for patches.
- **Residual-risk decisions are documented in the commit that makes them**
  (e.g. an advisory whose vulnerable code path can't execute in this
  architecture). Re-validate them at the quarterly pass — "not applicable"
  can rot as the stack changes.

---

## 15. Where to look when you're stuck

1. **[`CLAUDE.md`](../CLAUDE.md)** — the authoritative rules (security + business
   logic). If this guide and `CLAUDE.md` ever disagree, `CLAUDE.md` wins.
2. `docs/deployment-guide.md` — anything about running it on a real server.
3. `docs/mssql-migration.md` — the DB decision and remaining IT-owned cutover items.
4. The tests — `backend/tests/` and `frontend/src/test/` are the executable spec for
   how things are supposed to behave.
