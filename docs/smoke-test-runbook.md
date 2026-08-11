# Host smoke test — Drilling Sequence

**Goal:** prove the application runs correctly **on the deployment host** against a
test database, end to end (app boots → serves the built frontend → frontend calls
`/api` → backend reads/writes the DB), *before* requesting a dedicated production
database and before the full TLS/Windows-service setup.

**Scope:** this is a **functional** smoke test only. It runs in **dev mode**
(`DEV_MODE=true`, no Windows sign-in) over plain HTTP on port 8000. It does **not**
cover TLS, running as a Windows service, or the production fail-closed / Windows
Integrated Auth config — those are the next phase (see `deployment-guide.md` Appendix C).

> **Secrets:** the live DB password goes **only** in `backend\.env` (which is
> git-ignored). Never put it in this file, `.env.example`, or any tracked file.

Values in `<ANGLE_BRACKETS>` are environment-specific — fill them in from what your
DBA provides:

| Placeholder | Meaning |
|---|---|
| `<DB_HOST>` | SQL Server hostname (FQDN) |
| `<INSTANCE>` | named instance, if any (e.g. a non-default instance) |
| `<DB_NAME>` | the test database |
| `<DB_USER>` | SQL login |
| `<DB_PASSWORD>` | SQL login password (kept only in `.env`) |
| `<APP_DIR>` | the app checkout on the host, e.g. `E:\path\to\drilling_sequence` |

---

## 0. Test database facts (read first)

- If you are reusing an **existing, shared** database, check its current table names
  first. As long as this app's tables don't collide with the existing ones, it's safe:
  this app creates its own **unprefixed** tables (`users`, `projects`, `activities`,
  `signatures`, `revisions`, `audit_logs`, …) plus an `alembic_version` bookkeeping
  table, and never reads, alters, or drops anything else.
- The whole test is **reversible**: `alembic downgrade base` removes exactly the
  tables this app created and leaves any pre-existing tables untouched.

---

## 1. Prerequisites on the host

- [ ] **Windows Server** (the deployment host), with the app checked out at `<APP_DIR>`.
- [ ] **Python 3.11–3.14 (64-bit)** with the backend virtualenv created at
      `backend\venv` and `requirements.txt` installed (incl. `aioodbc` + `pyodbc`).
- [ ] **Microsoft ODBC Driver for SQL Server** installed on the host. Note which
      major version is present (**17** or **18**) — the connection string must name
      the one that's actually installed.
- [ ] **Node.js 20 LTS** (to build the frontend).
- [ ] Network reachability to `<DB_HOST>`. For a **named instance**, the **SQL
      Browser** service (UDP 1434) must be reachable so the instance resolves to its
      (often dynamic) port — a single TCP port probe is not enough.
- [ ] DB login from the DBA: `<DB_USER>` / database `<DB_NAME>`, with **`CREATE
      TABLE`** rights (`db_ddladmin`/`db_owner`) so the migration can run.

> **`requirements.txt` note:** `uvloop` is Unix-only and is pinned with a
> `; sys_platform != "win32"` marker so `pip install -r requirements.txt` works on
> Windows. If your host copy lacks that marker, you'll hit
> `RuntimeError: uvloop does not support Windows` — pull the current `requirements.txt`.

---

## 2. Configure `backend\.env`

Create/edit `<APP_DIR>\backend\.env`. For the smoke test you need only these keys
(no Windows-Auth, no TLS, no `STATIC_DIR` yet):

```ini
# Named instance -> the backslash before <INSTANCE> is URL-encoded as %5C.
# The driver name MUST match the ODBC driver installed on the host (17 or 18).
DATABASE_URL=mssql+aioodbc://<DB_USER>:<DB_PASSWORD>@<DB_HOST>%5C<INSTANCE>/<DB_NAME>?driver=ODBC+Driver+17+for+SQL+Server&Encrypt=yes&TrustServerCertificate=yes

ENVIRONMENT=development
DEV_MODE=true
```

Notes:
- If there is **no** named instance, use `@<DB_HOST>:<PORT>/<DB_NAME>` instead of
  `@<DB_HOST>%5C<INSTANCE>/...`.
- If the password contains URL-special characters (`@ : / ? # & % +`), percent-encode
  them (e.g. `@`→`%40`).
- `TrustServerCertificate=yes` is acceptable for this internal test. For production,
  prefer `no` plus a trusted certificate.

---

## 3. Verify the database connection (fast, read-only)

From `backend\` with the venv's Python. This is a plain `SELECT 1` — it creates
nothing. (Use the driver version installed on the host; backslash needs a raw string.)

```bat
venv\Scripts\python -c "import pyodbc; c=pyodbc.connect(r'DRIVER={ODBC Driver 17 for SQL Server};SERVER=<DB_HOST>\<INSTANCE>;DATABASE=<DB_NAME>;UID=<DB_USER>;PWD=<DB_PASSWORD>;Encrypt=yes;TrustServerCertificate=yes'); print(c.execute('SELECT 1').fetchone())"
```

**Expected:** `(1,)`

If this fails, fix it here before going further — see Troubleshooting (§9).

---

## 4. Create the application tables

From `backend\`:

```bat
cd <APP_DIR>\backend
venv\Scripts\alembic upgrade head
```

This applies migrations `001 → 014`, creating the app's tables. It also confirms the
login has `CREATE TABLE` rights.

**Expected:** a series of `Running upgrade ... -> ...` lines ending at the latest
revision, with no error.

---

## 5. Build the frontend

The single-process model has uvicorn serve the built SPA, so build it first
(Node 20 on the host):

```bat
cd <APP_DIR>\frontend
npm ci
npm run build
```

**Expected:** a `frontend\dist\` folder containing `index.html` and an `assets\`
directory.

---

## 6. Point the backend at the built frontend

Add this line to `backend\.env` (plain Windows path — **no** URL-encoding here):

```ini
STATIC_DIR=<APP_DIR>\frontend\dist
```

---

## 7. Run the app and verify

From `backend\`:

```bat
cd <APP_DIR>\backend
venv\Scripts\python -m uvicorn app.main:app --port 8000
```

On startup the log should include `Serving the built frontend from <APP_DIR>\frontend\dist`.
(If it instead says `STATIC_DIR is set but is not a directory`, the path is wrong or
the build didn't land there — fix and restart.)

Then verify, in a browser **on the host** (single origin — use `:8000`, not `:5173`):

- [ ] `http://localhost:8000/api/health` → `{"status":"ok"}`
- [ ] `http://localhost:8000/api/docs` → the API docs page loads
- [ ] `http://localhost:8000/` → the app UI loads. Because `DEV_MODE=true`, a dev user
      is injected (no Windows sign-in). Click through: create a project, add activities,
      etc., to confirm reads/writes hit the database.

Stop the server with `Ctrl+C` when done.

---

## 8. Clean up (leave the database pristine)

Before requesting the dedicated production database, remove the app's tables:

```bat
cd <APP_DIR>\backend
venv\Scripts\alembic downgrade base
```

This drops only the app's tables; any pre-existing tables are untouched. Optionally
drop the leftover `alembic_version` table for a fully original state. You may also
remove the `STATIC_DIR` line from `.env` afterward.

---

## 9. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Login failed for user '<DB_USER>' (18456)` | Wrong host/instance, or bad/rotated credential | Confirm the host and instance are **exactly** what the DBA provided — a single transposed character in the hostname silently connects you to a *different* server that rejects the login. Re-check the password. The DBA can read the **18456 state code** from the SQL error log to pinpoint it. |
| `Data source name not found and no default driver specified` | Connection string names a driver not installed | Match the URL's `driver=ODBC+Driver+NN...` to the version actually installed on the host (17 vs 18). |
| `Named Pipes Provider: Could not open a connection` / `server not found` | Instance/port not resolving | Use the **named-instance** form (`<DB_HOST>\<INSTANCE>`, backslash) and ensure SQL Browser (UDP 1434) is reachable. A forward slash or a dropped instance name causes this. |
| `Introducing FOREIGN KEY constraint ... may cause cycles or multiple cascade paths (1785)` | An MSSQL-incompatible `SET NULL`/self-ref FK | Should be fixed in migrations `004`/`009`/`011`. If you hit a *new* one, change that FK's `ondelete` to no action (NO ACTION) in the migration **and** model. |
| `RuntimeError: uvloop does not support Windows` | `requirements.txt` missing the platform marker | Use the current `requirements.txt` (uvloop pinned `; sys_platform != "win32"`). |
| `FAILED: No 'script_location' key found` | `alembic` run from the wrong directory | Run it from `backend\` (where `alembic.ini` lives). |
| `ModuleNotFoundError: No module named 'pyodbc'` | Wrong venv / deps not installed | Use `backend\venv\Scripts\python`; ensure `requirements.txt` is installed. |
| Page loads but every action fails | Frontend not same-origin as API | Browse to `:8000` (single-process), not `:5173`; confirm the `Serving the built frontend` log line. |

---

## 10. What this does NOT test (next phase)

- **TLS / HTTPS** (port 443, PEM cert + key).
- **Running as a Windows service** (`pywin32` + `windows_service.py`).
- **Production fail-closed config** (`ENVIRONMENT=production`, `DEV_MODE=false`,
  `PROXY_USER_HEADER` + `PROXY_SHARED_SECRET`) and the IIS **Windows Integrated Auth**
  setup that injects the user header (deployment-guide.md §2 / Appendix B, Variant 1).

See `deployment-guide.md` Appendix C for that production stand-up.
