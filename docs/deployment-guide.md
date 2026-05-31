# Deploying Drilling Sequence on the company internal server

**Audience:** the IT/ops person doing the install. No prior knowledge of this app
assumed. Follow the steps in order. Anything in `<ANGLE_BRACKETS>` is a value you
replace with your own.

> This is the **production** procedure. The `docker-compose.yml` and the two
> `Dockerfile`s in the repo are wired for **local development only** (they run with
> `DEV_MODE=true`, no real login, and the frontend runs the Vite dev server). Do
> **not** use them as-is in production.

---

## 0. The 10,000-foot view

Three pieces talk to each other:

```
        Browser (staff laptop, on the company network)
                         │  HTTPS
                         ▼
        ┌──────────────────────────────────────┐
        │  Reverse proxy  (nginx / IIS)          │   <- TLS terminates here
        │   •  serves the built frontend (static)│
        │   •  forwards /api/*  ->  backend:8000  │
        └───────────────┬───────────────────────┘
                        │ http (localhost only)
                        ▼
        ┌──────────────────────────────────────┐
        │  Backend  (FastAPI, Docker, port 8000) │
        └───────────────┬───────────────────────┘
                        │ ODBC / TDS (port 1433)
                        ▼
        ┌──────────────────────────────────────┐
        │  Microsoft SQL Server  (existing IT DB)│
        └──────────────────────────────────────┘

   Sign-in is handled by Microsoft Entra ID (Azure AD) — no passwords are
   stored in this app.
```

**The single most important rule:** the frontend calls the backend using
**relative URLs** (`/api/...`). That means the frontend and the backend **must be
served from the same web address (same origin)**. The reverse proxy makes that
happen: it serves the web pages *and* forwards `/api/*` to the backend. Get this
right and everything works; get it wrong and the app loads but every action fails.

---

## 1. What you need before you start (checklist)

- [ ] A Linux server on the internal network (Ubuntu 22.04 / Debian 12 recommended)
      with **Docker** installed. *(Windows alternative: see Appendix B.)*
- [ ] **Microsoft SQL Server** reachable from that server on port 1433, plus a
      database and a login (your DBA provides these — see Step 3).
- [ ] Two **Microsoft Entra ID (Azure AD) app registrations** (Step 2). Your Azure
      AD administrator does this.
- [ ] A **DNS name** for the app, e.g. `drilling.renaissanceafrica.com`, and a
      **TLS certificate** for it (internal CA is fine).
- [ ] The application source code on the server (`git clone` or a release zip).
- [ ] Outbound internet access **during the build only** (to download the Microsoft
      ODBC driver). The running app needs only the internal network.

---

## 2. Set up Microsoft Entra ID (Azure AD) sign-in

This is the part most likely to need your Azure admin. You create **two** app
registrations: one for the **API (backend)** and one for the **web app (frontend
SPA)**.

### 2a. API app registration (backend)
1. Entra ID → **App registrations** → **New registration**. Name it
   `Drilling Sequence API`. Single tenant.
2. **Expose an API** → set the Application ID URI (accept the default
   `api://<api-client-id>`) → **Add a scope** named e.g. `access_as_user`.
3. (Optional but recommended) **App roles** → create an app role named `Admin`
   (value `Admin`) → assigned to Users/Groups. This is how you grant global
   admins through Azure rather than the email allowlist.
4. Write down: **Directory (tenant) ID** and **Application (client) ID**.

### 2b. Web app (SPA) registration (frontend)
1. **New registration** → `Drilling Sequence Web` → Single tenant.
2. **Authentication** → Add platform → **Single-page application** → Redirect URI =
   `https://<your-app-dns>` (your production URL, exactly).
3. **API permissions** → Add a permission → My APIs → `Drilling Sequence API` →
   pick the `access_as_user` scope → **Grant admin consent**.
4. Write down the SPA **Application (client) ID** and the same **tenant ID**.

> You now have: `TENANT_ID`, `API_CLIENT_ID`, `SPA_CLIENT_ID`. You'll plug these
> into the backend and frontend config below.

---

## 3. Provision the database (your DBA)

Ask your SQL Server DBA for:
- A database named `drilling_sequence` (or your choice).
- A SQL login + password **scoped to that database** (db_owner on it is simplest
  for the initial migration; can be tightened afterwards).
- The server host/port and whether a **trusted TLS certificate** is presented
  (the ODBC driver encrypts by default — see the connection string note below).

Nothing needs to be created *inside* the database — the app builds its own tables
in Step 5 (`alembic upgrade head`).

> **Collation:** the app already lowercases emails on both store and compare, so a
> case-insensitive collation (the SQL Server default) is fine. Just confirm and
> keep it consistent.

---

## 4. Configure and build the backend

### 4a. Create the backend environment file
On the server, in `backend/`, create a file named `.env` (copy `.env.example` and
edit). Production values:

```ini
# Turns on fail-closed safety checks. With this set, the app REFUSES to start if
# DEV_MODE is true or the Azure IDs are missing — auth can never be bypassed.
ENVIRONMENT=production
DEV_MODE=false

# MSSQL connection (URL-encode special characters in the password).
# Encrypt=yes is the driver default; use a real server cert in prod. Only set
# TrustServerCertificate=yes if your DBA confirms there's no trusted cert.
DATABASE_URL=mssql+aioodbc://<DB_USER>:<DB_PASS>@<DB_HOST>:1433/drilling_sequence?driver=ODBC+Driver+18+for+SQL+Server&Encrypt=yes&TrustServerCertificate=no

# Azure AD — from Step 2a (the API registration).
AZURE_TENANT_ID=<TENANT_ID>
AZURE_CLIENT_ID=<API_CLIENT_ID>

# Comma-separated bootstrap admins (lowercased emails). These people are admins
# on first login even before the Azure "Admin" app role is assigned.
ADMIN_EMAILS=you@renaissanceafrica.com

# The public URL of the app. Used for CORS and for links inside notification emails.
ALLOWED_ORIGINS=https://<your-app-dns>
APP_BASE_URL=https://<your-app-dns>

# Email notifications (approvers get emailed when a revision needs them).
# Leave SMTP_HOST blank to disable email entirely — the app still runs fine.
SMTP_HOST=<internal-smtp-relay-or-blank>
SMTP_PORT=25
SMTP_FROM=Renaissance Drilling Sequence <no-reply@renaissanceafrica.com>
SMTP_USERNAME=
SMTP_PASSWORD=
SMTP_USE_TLS=false

LOG_LEVEL=INFO
```

> **Secrets:** `.env` contains a DB password. Keep it readable only by the service
> account (`chmod 600 .env`), and never commit it to git.

### 4b. Build and run the backend container
The backend `Dockerfile` already installs the Microsoft ODBC Driver 18 needed for
MSSQL. From `backend/`:

```bash
docker build -t drilling-backend:latest .

docker run -d --name drilling-backend \
  --restart unless-stopped \
  --env-file .env \
  -p 127.0.0.1:8000:8000 \
  drilling-backend:latest
```

Note `127.0.0.1:8000` — the backend is bound to localhost only. The public never
hits it directly; the reverse proxy does.

### 4c. Create the database tables (run once, and after every upgrade)
Run the Alembic migrations **inside** the container (it has the driver + the same
`.env`):

```bash
docker exec drilling-backend alembic upgrade head
```

This creates all tables on the MSSQL database. Re-run it after every code update
that ships new migrations.

### 4d. Verify the backend is alive
```bash
curl http://127.0.0.1:8000/api/health
# expect: {"status":"ok"}  (or similar 200 response)
```

If this fails, see Troubleshooting (§8).

---

## 5. Build the frontend (static files)

The frontend is compiled once into plain static files. **The Azure values are
baked in at build time**, so you must set them *before* building.

In `frontend/`, create `.env.production`:

```ini
VITE_DEV_MODE=false
VITE_AZURE_TENANT_ID=<TENANT_ID>
VITE_AZURE_CLIENT_ID=<SPA_CLIENT_ID>
VITE_AZURE_REDIRECT_URI=https://<your-app-dns>
```

Then build:

```bash
cd frontend
npm ci
npm run build
# Output lands in  frontend/dist/  — a folder of static HTML/JS/CSS.
```

Copy `frontend/dist/` to wherever your web server serves files from
(e.g. `/var/www/drilling`).

---

## 6. Set up the reverse proxy (the glue)

This is where the "same origin" rule is satisfied: one HTTPS site that serves the
static frontend **and** forwards `/api/*` to the backend.

### nginx example (`/etc/nginx/sites-available/drilling`)
```nginx
server {
    listen 443 ssl;
    server_name <your-app-dns>;

    ssl_certificate     /etc/ssl/certs/<your-cert>.pem;
    ssl_certificate_key /etc/ssl/private/<your-key>.pem;

    # 1) Serve the built frontend.
    root /var/www/drilling;
    index index.html;

    # 2) Forward API calls to the backend container.
    location /api/ {
        proxy_pass         http://127.0.0.1:8000;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }

    # 3) Single-page-app fallback: any non-file route returns index.html
    #    so deep links (e.g. /projects/abc/chart) work on refresh.
    location / {
        try_files $uri $uri/ /index.html;
    }
}

# Redirect plain HTTP to HTTPS.
server {
    listen 80;
    server_name <your-app-dns>;
    return 301 https://$host$request_uri;
}
```

```bash
ln -s /etc/nginx/sites-available/drilling /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

---

## 7. First login + smoke test (do this before telling users)

1. Browse to `https://<your-app-dns>`. You should see the Renaissance login screen
   with **Sign in with Microsoft**.
2. Sign in with an account whose email is in `ADMIN_EMAILS`. You should land on the
   Dashboard.
3. Run the end-to-end **MSSQL smoke test** (this is the real proof the database
   works):
   - Create a project.
   - Add 2–3 activities (different rigs/dates).
   - Designate yourself (or a colleague) as an approver.
   - Submit for approval (create a revision), then sign it.
   - Confirm it shows **Approved**, and check the **Activity Log** records the events.
4. Confirm an approver received the **email notification** (if SMTP is configured).

If all four pass, the deployment is good.

---

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Backend container exits immediately | `ENVIRONMENT=production` with `DEV_MODE=true` or missing Azure IDs (intentional fail-closed) | Fix `.env`; both Azure IDs must be set and `DEV_MODE=false`. |
| Page loads but every action fails / 404 on `/api/...` | Reverse proxy not forwarding `/api` (same-origin rule broken) | Re-check the `location /api/` block; confirm backend is up on `127.0.0.1:8000`. |
| `Login failed` / redirect loop | SPA redirect URI mismatch | The Entra **redirect URI** must exactly equal `https://<your-app-dns>` and match `VITE_AZURE_REDIRECT_URI`. |
| Backend can't reach DB (`Login timeout` / `ODBC`) | Firewall, wrong host, or TLS cert | Confirm port 1433 open; if no trusted cert, set `TrustServerCertificate=yes` (with DBA approval). |
| `alembic upgrade head` errors on a TYPE/now() | Old/un-ported migration | Ensure you're on the current code (migrations were made MSSQL-portable). |
| Deep link 404 on refresh (e.g. `/projects/x/chart`) | Missing SPA fallback | Add the `try_files ... /index.html` block. |

Backend logs: `docker logs drilling-backend`.

---

## 9. Day-2 operations

- **Backups:** the only stateful component is the MSSQL database — include it in the
  company's normal SQL Server backup schedule. The app itself is stateless.
- **Upgrades:** pull new code → `docker build` → `docker run` (replace container) →
  `docker exec drilling-backend alembic upgrade head` → rebuild frontend
  (`npm run build`) → redeploy `dist/`.
- **Logs:** `docker logs -f drilling-backend`. Set `LOG_LEVEL=DEBUG` temporarily to
  diagnose, then back to `INFO`.
- **Adding admins:** assign the Entra `Admin` app role, or add the email to
  `ADMIN_EMAILS` and restart the backend.

---

## Appendix A — Security reminders (don't skip)
- `ENVIRONMENT=production` + `DEV_MODE=false` is mandatory in prod. The app
  **refuses to start** otherwise — that's a feature, not a bug.
- The backend listens on `127.0.0.1` only; never expose port 8000 to the network.
- TLS terminates at the reverse proxy; the internal hop to the backend is localhost.
- Keep `.env` `chmod 600`; rotate the DB password per company policy.
- The app stores no passwords — identity is entirely Microsoft Entra ID.

## Appendix B — If your internal server is Windows
The architecture is identical; only the tooling changes:
- **Reverse proxy / static host:** IIS with the URL Rewrite + Application Request
  Routing modules (serve `dist/`, reverse-proxy `/api` to `http://127.0.0.1:8000`).
- **Backend:** run the same Docker image under Docker Desktop / Windows containers,
  or run uvicorn directly as a Windows service (install Python 3.11 + the Microsoft
  ODBC Driver 18 on the host first).
- Everything else (env vars, Azure setup, MSSQL, smoke test) is the same.

---

*Open items still owned by IT before go-live are tracked in
[`mssql-migration.md`](./mssql-migration.md) §5 (auth method, server cert,
collation, host/port).*
