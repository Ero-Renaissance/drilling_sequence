# Drilling Sequence

Internal oil & gas **rig scheduling and formal-approval** tool for Renaissance
Africa Energy. Plan the drilling sequence on a visual timeline, track activity
readiness, and route plan versions through a signed, audited approval workflow.

**Stack:** FastAPI + async SQLAlchemy 2.0 + Pydantic v2 (backend) · React 18 +
TypeScript + Vite (frontend) · Microsoft SQL Server (prod) / SQLite (dev & tests) ·
Microsoft Entra ID (Azure AD) SSO.

## Documentation

| Guide | Read it if you are… |
|---|---|
| **[User Guide](docs/user-guide.md)** | A new user — signing in, the chart, readiness, the approval workflow, CSV import. |
| **[Deployment Guide](docs/deployment-guide.md)** | Deploying it on the company internal server (step by step). |
| **[Maintainer Guide](docs/maintainer-guide.md)** | A developer maintaining or extending the code. |
| **[RBAC Reference](docs/rbac-reference.md)** | Assigning roles, or reviewing who can do what (the access model as enforced). |
| **[MSSQL Migration Notes](docs/mssql-migration.md)** | Working on the database / the Postgres→MSSQL move. |
| **[CLAUDE.md](CLAUDE.md)** | **The binding security & business rules — the source of truth.** |

To bulk-load activities, use **Import CSV / Excel** in the app and click
**Download a blank template** (format documented in the [User Guide](docs/user-guide.md)).

## Quick start (local development)

```bash
# Backend  (http://localhost:8000, API docs at /api/docs)
cd backend
python3.11 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env            # dev defaults: SQLite + DEV_MODE=true (no Azure needed)
uvicorn app.main:app --reload

# Frontend (http://localhost:5173)
cd frontend
npm install
cp .env.example .env.local      # VITE_DEV_MODE=true
npm run dev
```

In dev mode, sign in with **"Continue as Dev User"** — no Azure AD required.
For everything else, start with the [Maintainer Guide](docs/maintainer-guide.md).

## Repository layout

```
backend/    FastAPI app, models, routers, services, Alembic migrations, tests
frontend/   React/TypeScript SPA (Vite)
docs/        the guides above
CLAUDE.md    security + business rules (authoritative)
```

## Quality gates

Run before committing (no CI is configured yet):

```bash
cd backend  && pytest -q && ruff check app/ alembic/
cd frontend && npm run lint && npm test
```
