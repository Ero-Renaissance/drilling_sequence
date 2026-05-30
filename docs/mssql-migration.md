# Migrating the Drilling Sequence backend from PostgreSQL to Microsoft SQL Server

**Status:** scoping only — no code changed yet.
**Bottom line:** ~0.5–1 day of work, almost all of it environment/packaging and
migration verification. The application code barely moves because the schema and
queries already go entirely through the SQLAlchemy ORM (a side benefit of the
security hardening — no raw SQL anywhere).

---

## 1. Why this is low-effort

A full audit of `backend/app/models` and the routers/services found **none** of
the usual Postgres lock-ins:

| Risk usually seen in a PG→MSSQL port | Present here? |
|---|---|
| `JSONB` / `ARRAY` / `postgresql.*` dialect types | No |
| Raw SQL / `text()` with interpolation | No |
| Unbounded `String` (→ `VARCHAR(max)`, index issues) | No — every column has an explicit length, max 1024 |
| UNIQUE constraints on nullable columns (MSSQL treats NULLs as equal) | No — all unique constraints are on NOT-NULL columns |
| `LIMIT/OFFSET` without `ORDER BY` (MSSQL requires it) | No — every paginated query has `order_by` |
| DB-generated UUIDs | No — UUIDs are generated in Python (`default=uuid.uuid4`) |

Portable types map cleanly:
- `Mapped[uuid.UUID]` → `UNIQUEIDENTIFIER`
- `DateTime(timezone=True)` → `DATETIMEOFFSET`
- `Boolean` + `expression.false()` → `BIT` / `0`
- `server_default=func.now()` → `SYSDATETIMEOFFSET()` (dialect-handled)

---

## 2. Code changes (small)

### a. Connection string — `app/config.py`
```python
# from:
database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/drilling_sequence"
# to (async MSSQL via aioodbc → pyodbc → ODBC Driver 18):
database_url: str = (
    "mssql+aioodbc://USER:PASS@HOST:1433/drilling_sequence"
    "?driver=ODBC+Driver+18+for+SQL+Server&Encrypt=yes&TrustServerCertificate=no"
)
```
Keep this as an env var (`DATABASE_URL`) so Postgres/SQLite still work for local
dev and tests — do not hardcode MSSQL.

### b. Engine args — `app/database.py`
The existing `_is_sqlite` branch stays (tests still use SQLite). No MSSQL-specific
`connect_args` are required for a basic setup; if connection pooling needs tuning
under the company network, add `pool_pre_ping=True`.

### c. Dependencies — `pyproject.toml`
```
# remove: "asyncpg>=0.29.0"
# add:    "aioodbc>=0.5.0", "pyodbc>=5.1.0"
```
Per the dependency-governance rules in `CLAUDE.md`: both are widely used, MIT-licensed,
and pure-Python wrappers over the system ODBC driver. Flag for IT review.

### d. Dockerfile — install the ODBC driver (the real new dependency)
The async MSSQL path needs the **Microsoft ODBC Driver 18 + unixODBC** at the OS
level (not just pip). Add to `backend/Dockerfile`:
```dockerfile
RUN apt-get update && apt-get install -y curl gnupg unixodbc-dev \
 && curl -fsSL https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor -o /usr/share/keyrings/microsoft-prod.gpg \
 && curl -fsSL https://packages.microsoft.com/config/debian/12/prod.list > /etc/apt/sources.list.d/mssql-release.list \
 && apt-get update && ACCEPT_EULA=Y apt-get install -y msodbcsql18 \
 && rm -rf /var/lib/apt/lists/*
```
*(Adjust the distro path — `debian/12`, `ubuntu/22.04`, etc. — to match the base image.)*

---

## 3. Migrations

The 10 existing Alembic migrations were authored against Postgres/SQLite. They
will mostly render on MSSQL but `UNIQUEIDENTIFIER` / `DATETIMEOFFSET` emit
differently and need verification against a real instance.

**Recommended:** because the deployment is tiny (1–10 users, <20 projects) and not
yet in production, squash to a **single fresh initial migration generated against
MSSQL** rather than replaying/patching the 10-step chain. Simpler and removes the
risk of a mid-chain dialect failure.

---

## 4. Testing

**Decision: tests stay on in-memory SQLite (`aiosqlite`).** Fast, no server
required, and the ORM-only schema means SQLite catches the vast majority of logic
bugs. Trade-off accepted: dialect-specific behavior (collation, DATETIMEOFFSET
precision) is **not** exercised until deploy. Mitigation: run one manual
smoke-test of the app against a real MSSQL instance before go-live, covering
create project → add activities → sign/approve revision → audit log.

---

## 5. Open questions for IT (confirm before implementing)

1. **ODBC Driver 18** defaults to `Encrypt=yes`. Is there a trusted server
   certificate, or should we set `TrustServerCertificate=yes` for the internal
   host? (Prefer a real cert.)
2. **Authentication:** SQL login (user/pass in a secret) or **Azure AD /
   Integrated auth** to the SQL Server? AAD auth changes the connection string and
   avoids storing a DB password.
3. **Collation:** MSSQL default is case-insensitive. The approver email match
   already lowercases on both store and compare so it's correct, but please confirm
   the DB/column collation so we pin it explicitly (recommend a deterministic,
   case-insensitive collation documented in the schema).
4. **Host/port/instance name** and whether connection pooling limits are imposed
   by the SQL Server.

---

## 6. Effort summary

| Task | Effort | Nature |
|---|---|---|
| config.py / database.py / pyproject.toml edits | minutes | code |
| Dockerfile ODBC install + image rebuild | 1–2 hrs | packaging |
| Squash + generate MSSQL initial migration, verify | 2–3 hrs | DB |
| Manual smoke test against real MSSQL | 1 hr | QA |
| **Total** | **~0.5–1 day** | mostly ops, not code |
