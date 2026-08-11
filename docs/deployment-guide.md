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

   Sign-in is handled by the company Windows domain (Kerberos/NTLM) at the reverse
   proxy: users are signed in automatically with their Windows login and this app
   stores no passwords. The proxy passes the authenticated username to the backend
   in a trusted header. (See §2 for why this replaced the original Azure AD design.)
```

**The single most important rule:** the frontend calls the backend using
**relative URLs** (`/api/...`). That means the frontend and the backend **must be
served from the same web address (same origin)**. The reverse proxy makes that
happen: it serves the web pages *and* forwards `/api/*` to the backend. Get this
right and everything works; get it wrong and the app loads but every action fails.

---

## 1. What you need before you start (checklist)

- [ ] A **Windows Server** on the internal network with **IIS** (recommended — IIS
      performs the Windows Integrated Auth; see Appendix B). *(A Linux/nginx host is
      possible only if the proxy is configured for Kerberos/SPNEGO — see §6.)*
- [ ] **Microsoft SQL Server** reachable from that server on port 1433, plus a
      database and a login (your DBA provides these — see Step 3).
- [ ] A front door that can perform **Windows Integrated Authentication** — in
      practice **IIS on Windows Server** (Step 2 / Appendix B). Your Windows/AD
      administrator enables it, plus a **domain service account** to run the app.
- [ ] A **DNS name** for the app, e.g. `drilling.renaissanceafrica.com`, and a
      **TLS certificate** for it (internal CA is fine).
- [ ] The application source code on the server (`git clone` or a release zip).
- [ ] Outbound internet access **during the build only** (to download the Microsoft
      ODBC driver). The running app needs only the internal network.

---

## 2. Set up Windows Integrated Authentication (sign-in)

**Why this design.** The original build used Microsoft Entra ID (Azure AD) SSO, but
company IT does not support Azure sign-in for this app. Instead, authentication is
delegated to the **reverse proxy** (IIS on Windows), which authenticates each user
against the **Windows domain** using **Integrated Authentication (Negotiate →
Kerberos, with NTLM fallback)** — the same silent sign-on staff already get from
other internal sites. There are no passwords, tokens, app registrations, or redirect
URIs to manage.

**How it works (the trust boundary).** The proxy authenticates the browser and then
forwards each `/api` request to the backend with the signed-in Windows account in a
trusted header (default `X-Remote-User`). The backend reads that header, upserts the
user on first sight, and applies the same role checks as before. Because a header is
only as trustworthy as whoever can set it, three things protect it:

1. **uvicorn is bound to `127.0.0.1`** (§4b / Appendix B), so only the local proxy —
   never a user's browser — can reach the backend and present a header.
2. **The proxy overwrites the header** from its own authenticated `LOGON_USER` on
   every request, so a value a client tries to inject is discarded.
3. **An optional shared secret** (`PROXY_SHARED_SECRET`, sent as `X-Proxy-Auth`) must
   match, so even a request that somehow reached the backend directly is rejected.

**What you configure.** On the IIS site that fronts the app: enable **Windows
Authentication**, disable **Anonymous**, and inject the authenticated user into the
`X-Remote-User` header. The exact IIS steps live in **Appendix B (Variant 1)** — that
is now the recommended production path, because IIS is what performs the handshake.
Admins are listed by Windows email or username in `ADMIN_EMAILS` (§4a); there is no
directory role to assign.

> One prerequisite for silent sign-on: the app's URL must be in each browser's
> **Local Intranet** (trusted) zone — normally pushed by GPO — so Windows sends the
> Kerberos ticket without prompting. If it isn't, users get a username/password
> prompt instead of seamless SSO.

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
On the server, in `backend/`, create a file named `.env` with the production
values below (the canonical list of settings is `backend/app/config.py` — every
field reads the matching env var):

```ini
# Turns on fail-closed safety checks. With this set, the app REFUSES to start if
# DEV_MODE is true or PROXY_USER_HEADER is missing — auth can never be bypassed.
ENVIRONMENT=production
DEV_MODE=false

# MSSQL connection (URL-encode special characters in the password).
# Encrypt=yes is the driver default; use a real server cert in prod. Only set
# TrustServerCertificate=yes if your DBA confirms there's no trusted cert.
# On Windows you can instead use Integrated (Windows) auth and store NO DB
# password — see Appendix B.2 for that connection string.
DATABASE_URL=mssql+aioodbc://<DB_USER>:<DB_PASS>@<DB_HOST>:1433/drilling_sequence?driver=ODBC+Driver+18+for+SQL+Server&Encrypt=yes&TrustServerCertificate=no

# Windows Integrated Auth (see §2). The reverse proxy authenticates the user and
# injects their Windows account into this header on every request; the backend
# trusts it ONLY because uvicorn is bound to localhost (§4b) and, optionally, the
# shared secret below must match. Must be set in production (fail-closed).
PROXY_USER_HEADER=X-Remote-User

# Optional but recommended: a random shared secret the proxy must also send (in the
# X-Proxy-Auth header). Rejects any request that doesn't present it, so a forged
# user header can't be trusted even if the backend is reached directly.
PROXY_SHARED_SECRET=<paste a long random string>

# Optional. The proxy gives us only the Windows account name; this builds each
# user's email as <username>@<domain>. Needed so approval-decision emails to the
# planner who created a revision reach a real mailbox.
USER_EMAIL_DOMAIN=renaissanceafrica.com

# Comma-separated admins (lowercased), matched against either the user's email or
# their Windows username. This is the source of truth for global admins.
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

> A `backend/.dockerignore` keeps `tests/`, the local `.venv/`, `.env`, and the
> dev SQLite file **out** of the image — so secrets and test code are never
> shipped, and the image stays small. Don't delete it.

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

The frontend is compiled once into plain static files. There's no client-side auth
config any more — the browser is authenticated by the reverse proxy and the SPA
carries no tokens — so the only build-time flag is dev mode (off in production).

In `frontend/`, create `.env.production`:

```ini
VITE_DEV_MODE=false
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

This is where two rules are satisfied at once: (1) the "same origin" rule — one HTTPS
site serves the static frontend **and** forwards `/api/*` to the backend — and (2)
**authentication**: the proxy performs Windows Integrated Auth and passes the signed-in
user to the backend in the header named by `PROXY_USER_HEADER`.

> **Windows Auth needs the right front door.** The Negotiate/Kerberos handshake is
> done by **IIS on Windows** — see **Appendix B**, the recommended production path,
> which shows the exact Windows-Authentication + header-injection config. The nginx
> example below covers TLS, static serving and the SPA fallback, but **nginx cannot do
> Windows Integrated Auth** without the `mod_auth_gssapi` module and a Kerberos keytab;
> if you must use it, add that module, inject `$remote_user` into the header, and strip
> any client-supplied copy. For most installs, use IIS.

### nginx example (TLS + static + SPA fallback; add mod_auth_gssapi for Windows Auth)
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
        # Windows Auth requires mod_auth_gssapi + a Kerberos keytab (see the note
        # above). Once the user is authenticated, pass them to the backend as the
        # PROXY_USER_HEADER and let proxy_set_header overwrite any client-sent copy:
        #   auth_gss on;  auth_gss_keytab /etc/krb5.keytab;
        proxy_set_header   X-Remote-User     $remote_user;
        proxy_set_header   X-Proxy-Auth      "<same value as PROXY_SHARED_SECRET>";
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

1. Browse to `https://<your-app-dns>` from a domain-joined PC, logged in with your
   Windows account. You should be signed in **automatically** (no prompt) and land on
   the Dashboard — the proxy authenticated you and the app resolved your account.
2. Confirm you have admin (your Windows email or username is in `ADMIN_EMAILS`).
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
| Backend container exits immediately | `ENVIRONMENT=production` with `DEV_MODE=true` or missing `PROXY_USER_HEADER` (intentional fail-closed) | Fix `.env`; `PROXY_USER_HEADER` must be set and `DEV_MODE=false`. |
| Page loads but every action fails / 404 on `/api/...` | Reverse proxy not forwarding `/api` (same-origin rule broken) | Re-check the `location /api/` block; confirm backend is up on `127.0.0.1:8000`. |
| Every request is 401 / stuck signing in | Proxy isn't sending the user header, or the shared secret doesn't match | Confirm the IIS site has **Windows Authentication** on and **Anonymous** off, and injects `X-Remote-User` from `LOGON_USER`; check `PROXY_SHARED_SECRET` equals the `X-Proxy-Auth` the proxy sends. |
| Browser prompts for a username/password instead of signing in silently | The app URL isn't in the browser's Local Intranet / trusted zone | Add `https://<your-app-dns>` to the Local Intranet zone (usually via GPO) so Windows sends the Kerberos ticket automatically. |
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
- **Adding admins:** add the person's Windows email or username to `ADMIN_EMAILS`
  and restart the backend — or grant them on the in-app Admin page (which persists).

---

## Appendix A — Security reminders (don't skip)
- `ENVIRONMENT=production` + `DEV_MODE=false` is mandatory in prod. The app
  **refuses to start** otherwise — that's a feature, not a bug.
- The backend listens on `127.0.0.1` only; never expose port 8000 to the network.
- TLS terminates at the reverse proxy; the internal hop to the backend is localhost.
- Keep `.env` `chmod 600`; rotate the DB password per company policy.
- The app stores no passwords — identity comes from the Windows domain via the
  proxy. Keep uvicorn bound to `127.0.0.1` and set `PROXY_SHARED_SECRET`, so the
  trusted user header can't be forged by anything that reaches the backend directly.

## Appendix B — Deploying on Windows Server

*Verified target: **Windows Server 2022 Standard** (also applies to 2019/2022, Standard
or Datacenter). The **Standard** edition is sufficient — none of the Datacenter-only
features matter here. Use the **native path** below: Docker Desktop is a workstation
tool and is not supported on Windows Server, so skip B.7 on a Server SKU.*

**This is the recommended production path**, because IIS is what performs the Windows
Integrated Auth (§2). The OS-agnostic steps are unchanged: **Windows-Auth setup (§2),
database provisioning (§3), the `.env` keys (§4a), the frontend build (§5), and the
smoke test (§7) apply as written.** Only the host tooling differs. Pick one hosting
model with IT:

- **Native (recommended on Windows Server):** install Python + the ODBC driver on the
  host and run uvicorn behind IIS — either as its own Windows service (ARR) or launched
  by IIS itself (HttpPlatformHandler); see the B.4/B.6 fork. No Docker licensing, and
  it's the supported way to run a long-lived service on Server SKUs.
- **Docker Desktop:** reuse the existing Linux backend image (see B.7). Simple if IT
  already standardises on containers, but note Docker Desktop licensing and that it's a
  workstation tool, not really a Server service host.

> uvicorn runs natively on Windows — it just uses the asyncio proactor event loop
> instead of `uvloop` (which is Unix-only and simply isn't installed). No code change.

### B.1 Prerequisites (native path)
- [ ] **Windows Server 2019/2022** on the internal network.
- [ ] **Python 3.11–3.14 (64-bit)** from python.org — tick *"Add python.exe to PATH"*.
      Any of 3.11, 3.12, 3.13, or 3.14 works: every pinned dependency that carries a
      compiled extension (pydantic-core 2.46.4, pyodbc **5.3.0**, asyncpg, httptools,
      watchfiles) ships prebuilt `cp311`–`cp314` `win_amd64` wheels, so `pip install`
      never needs a build toolchain. (pyodbc had to be bumped from 5.2.0 → 5.3.0 for
      this: 5.2.0 stopped at `cp313` and would have forced a source build on 3.14.)
      If several Pythons are installed, `py -3.14` (or `-3.11`, etc.) picks a specific one.
- [ ] **Microsoft ODBC Driver 17 for SQL Server** (x64 MSI) — or **Driver 18** if that's
      what's already on the host; just match the `DATABASE_URL` driver name. Note Driver 17
      defaults to `Encrypt=no` (Driver 18 defaults to `Encrypt=yes`), so the `DATABASE_URL`
      below sets `Encrypt=yes` explicitly to force TLS regardless of which driver is installed.
- [ ] **IIS (Web Server role)** — not installed by default on Server; add it first
      (B.6 step 1). Then pick **one** front-end module set (see the B.4/B.6 fork):
      - **HttpPlatformHandler** — a single Microsoft-signed MSI. IIS *launches* uvicorn
        and *forwards* to it, so this one module replaces **both** ARR and NSSM.
        **Recommended**, especially when ARR/NSSM can't be approved (B.4 Option 2 + B.6
        Variant 2).
      - **URL Rewrite 2.1 + Application Request Routing (ARR) 3.0** — two free Microsoft
        modules; IIS proxies to a uvicorn service you run separately (B.4 Option 1 + B.6
        Variant 1).
- [ ] **NSSM** (nssm.cc) to run uvicorn as a service — needed **only** for the ARR path
      (B.4 Option 1); HttpPlatformHandler doesn't use it. If you can install *neither* an
      IIS proxy module *nor* NSSM, use **Appendix C** (uvicorn serves everything) instead.
- [ ] A **domain service account** to run the app (required for Integrated SQL auth).
- [ ] Node.js 20 LTS **only on the machine that builds the frontend** — `dist/` can be
      built elsewhere and copied over.

### B.2 Install and configure the backend
From `backend\`:
```bat
py -3.11 -m venv .venv
.venv\Scripts\python -m pip install --upgrade pip
.venv\Scripts\python -m pip install -r requirements.txt
```
> The commands above call `.venv\Scripts\python` directly, so they work regardless of
> PowerShell's execution policy (a hardened Server often blocks `Activate.ps1`). The
> service in B.4 runs `python.exe` directly too, so it's unaffected. Only *interactive*
> `Activate.ps1` needs `Set-ExecutionPolicy -Scope Process RemoteSigned` (or use `activate.bat`).
Create `backend\.env` with the keys from §4a. For `DATABASE_URL`, use the auth style
IT chose:
```ini
:: (a) SQL login + password — URL-encode special characters in the password:
DATABASE_URL=mssql+aioodbc://<DB_USER>:<DB_PASS>@<DB_HOST>:1433/drilling_sequence?driver=ODBC+Driver+17+for+SQL+Server&Encrypt=yes&TrustServerCertificate=no

:: (b) Windows / Integrated auth — NO password stored; the service account running
::     the app must be the SQL principal with access. Note the empty credentials (@):
DATABASE_URL=mssql+aioodbc://@<DB_HOST>:1433/drilling_sequence?driver=ODBC+Driver+17+for+SQL+Server&Trusted_Connection=yes&Encrypt=yes&TrustServerCertificate=no
```
Lock down the secret file (the Windows equivalent of `chmod 600`):
```bat
icacls .env /inheritance:r /grant:r "<DOMAIN\svc-drilling>:R" "Administrators:F"
```

### B.3 Create the database tables (run once, and after each upgrade)
```bat
cd backend
.venv\Scripts\alembic upgrade head
```
Reads the same `.env`. **With Integrated auth**, run this *as the service account*
(e.g. an elevated shell opened via `runas /user:<DOMAIN\svc-drilling> cmd`) so SQL
Server sees the right identity.

### B.4 Run uvicorn under IIS — pick the model that matches your modules
The process can be hosted two ways; this maps directly onto the B.6 variants:
- **Option 1 — NSSM service + ARR** (B.6 Variant 1): you run uvicorn as its own Windows
  service, IIS proxies to it.
- **Option 2 — HttpPlatformHandler** (B.6 Variant 2): IIS launches and supervises uvicorn
  itself — **no separate service, no ARR.** Recommended when NSSM/ARR are unavailable.

Either way uvicorn binds **localhost only** — IIS is the public face.

**Option 1 — NSSM (simplest, needs ARR for B.6):**
```bat
nssm install DrillingBackend "C:\apps\drilling\backend\.venv\Scripts\python.exe" "-m uvicorn app.main:app --host 127.0.0.1 --port 8000"
nssm set DrillingBackend AppDirectory "C:\apps\drilling\backend"
nssm set DrillingBackend Start SERVICE_AUTO_START
:: For Integrated auth, run the service AS the domain account:
nssm set DrillingBackend ObjectName "<DOMAIN\svc-drilling>" "<password>"
nssm start DrillingBackend
```
Verify it's up on loopback:
```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/health    # -> {"status":"ok"}
```
(or `curl http://127.0.0.1:8000/api/health` — `curl.exe` ships with Server 2019+.)

**Option 2 — IIS HttpPlatformHandler (no separate service):**
Install the module, then define an **application pool** to own the uvicorn process (IIS
Manager → Application Pools → Add; call it `DrillingPool`). There's nothing else to
"start" — the process itself is declared by the `<httpPlatform>` element in B.6 Variant 2's
`web.config`, and IIS launches it with the pool. Set on the pool:
- **.NET CLR version → "No Managed Code"** (there is no .NET app to load).
- **Identity → your `<DOMAIN\svc-drilling>` account.** This is where the Integrated-auth
  service account moves to — it replaces NSSM's `ObjectName`; uvicorn (and therefore its
  SQL connection) runs as this identity.
- **Start Mode → "AlwaysRunning"** and **Idle Time-out (minutes) → 0.** Without this the
  pool idles out after 20 min and HttpPlatformHandler tears uvicorn down between requests —
  NSSM never did that, so it's the easiest difference to get burned by.

> **Paste into the IT security-review request** — what HttpPlatformHandler is, in three
> lines: *A Microsoft-signed IIS module that launches a local process and forwards requests
> to it on the **loopback interface only**. Its scope is strictly process-launch + loopback
> forwarding — unlike ARR it exposes no general URL-proxy/cache surface and cannot be turned
> into an open proxy. One signed MSI, no post-install scripts or binary downloads.*

uvicorn binds the private `%HTTP_PLATFORM_PORT%` IIS hands it (not a fixed `:8000`), so
there's nothing to curl directly here — verify through IIS once B.6 is in place
(`Invoke-RestMethod https://<your-app-dns>/api/health`).

### B.5 Build and place the frontend
Build exactly as §5 (`npm ci && npm run build`), then copy `frontend\dist\` to where the
front end is served from:
- **ARR variant:** the IIS site content root, e.g. `C:\inetpub\drilling` (IIS serves it).
- **HttpPlatformHandler variant:** the folder `STATIC_DIR` points at, e.g.
  `C:\apps\drilling\web` (uvicorn serves it — see B.6 Variant 2).

### B.6 IIS as the front end (the "same origin" glue)
Two variants, matching the B.4 choice. **Variant 1** (URL Rewrite + ARR) proxies to the
uvicorn *service*; **Variant 2** (HttpPlatformHandler) has IIS launch uvicorn, which also
serves the SPA. Steps 1–2 are shared.

1. **Enable the IIS role** (Server Manager → Add Roles, or PowerShell as admin):
   ```powershell
   Install-WindowsFeature -Name Web-Server -IncludeManagementTools
   ```
2. Add an **HTTPS binding (443)** to the site with your TLS certificate (Server
   Certificates → import the `.pfx` first). Add a separate HTTP→HTTPS redirect
   binding/rule as policy requires.

**Variant 1 — URL Rewrite + ARR.** Install **URL Rewrite** + **ARR**, then IIS Manager →
server node → **Application Request Routing Cache → Server Proxy Settings → tick "Enable
proxy."** Root the site at the frontend (`C:\inetpub\drilling`, per B.5) and put this
`web.config` in the site root:
```xml
<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
        <!-- 1) Forward /api/* to the backend on localhost. -->
        <rule name="api-proxy" stopProcessing="true">
          <match url="^api/(.*)" />
          <action type="Rewrite" url="http://127.0.0.1:8000/api/{R:1}" />
          <serverVariables>
            <set name="HTTP_X_FORWARDED_PROTO" value="https" />
            <!-- Pass the Windows-authenticated user to the backend (= PROXY_USER_HEADER).
                 Setting it here OVERWRITES any X-Remote-User a client tried to send. -->
            <set name="HTTP_X_REMOTE_USER" value="{LOGON_USER}" />
            <!-- Shared secret the backend verifies (= PROXY_SHARED_SECRET). -->
            <set name="HTTP_X_PROXY_AUTH" value="<same value as PROXY_SHARED_SECRET>" />
          </serverVariables>
        </rule>
        <!-- 2) SPA fallback: anything that isn't a real file/dir -> index.html. -->
        <rule name="spa" stopProcessing="true">
          <match url=".*" />
          <conditions logicalGrouping="MatchAll">
            <add input="{REQUEST_FILENAME}" matchType="IsFile" negate="true" />
            <add input="{REQUEST_FILENAME}" matchType="IsDirectory" negate="true" />
          </conditions>
          <action type="Rewrite" url="/index.html" />
        </rule>
      </rules>
    </rewrite>
  </system.webServer>
</configuration>
```
Two IIS settings make sign-in work:
- **Enable Windows Authentication and disable Anonymous** on the site (IIS Manager →
  *Authentication*; add the *Windows Authentication* role service first if it's
  missing). This is what makes the browser do the Kerberos/NTLM handshake, so
  `{LOGON_USER}` is populated.
- **Allow the server variables** you set above: URL Rewrite → **View Server Variables**
  → add `HTTP_X_FORWARDED_PROTO`, `HTTP_X_REMOTE_USER`, and `HTTP_X_PROXY_AUTH`. (ARR
  forwards `X-Forwarded-For` automatically.)

Then set `PROXY_USER_HEADER=X-Remote-User` and the matching `PROXY_SHARED_SECRET` in
`backend\.env` (§4a). IIS overwrites `X-Remote-User` from the authenticated `LOGON_USER`
on every request, so a client can't forge it; the localhost-only backend bind (B.4) and
the shared secret are the belt-and-braces.

**Variant 2 — HttpPlatformHandler (one module; no ARR, no separate service).** IIS
launches uvicorn (B.4 Option 2) *and* forwards to it, and uvicorn serves the SPA, so the
site needs no rewrite rules. Install **HttpPlatformHandler** instead of URL Rewrite + ARR,
and do **not** enable the ARR proxy.

Root the IIS site's **physical path at the backend folder** (`C:\apps\drilling\backend`),
not at `dist\`. HttpPlatformHandler runs uvicorn with the site path as its working
directory, and the app reads `.env` relative to that directory — anchoring the site at the
backend folder is what lets `.env` resolve. The built frontend lives wherever `STATIC_DIR`
points (B.5), so it needn't sit under the site root. `web.config` in that root:
```xml
<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <system.webServer>
    <handlers>
      <add name="httpPlatformHandler" path="*" verb="*"
           modules="httpPlatformHandler" resourceType="Unspecified" requireAccess="Script" />
    </handlers>
    <!-- IIS launches uvicorn on a private loopback port (%HTTP_PLATFORM_PORT%),
         supervises it with the app pool, and forwards every request to it. -->
    <httpPlatform processPath="C:\apps\drilling\backend\.venv\Scripts\python.exe"
                  arguments="-m uvicorn app.main:app --host 127.0.0.1 --port %HTTP_PLATFORM_PORT%"
                  stdoutLogEnabled="true"
                  stdoutLogFile="C:\apps\drilling\logs\stdout.log"
                  startupTimeLimit="60" processesPerApplication="1">
      <environmentVariables>
        <!-- Makes uvicorn serve the built SPA (assets + index.html fallback). -->
        <environmentVariable name="STATIC_DIR" value="C:\apps\drilling\web" />
      </environmentVariables>
    </httpPlatform>
  </system.webServer>
</configuration>
```
Variant-2 specifics:
- **Windows Integrated Auth (SSO) is *not* supported by this variant.**
  HttpPlatformHandler forwards to uvicorn but does **not** inject the authenticated
  Windows user as a request header, so the backend can't identify the caller. Use
  **Variant 1 (URL Rewrite + ARR)** for production sign-in; Variant 2 suits `DEV_MODE`
  testing (Appendix D) or a future non-Windows identity source.
- **`STATIC_DIR` is required, not optional.** The handler forwards *everything* to uvicorn,
  so uvicorn (via `app/static_spa.py`) serves the SPA and does the `index.html` fallback.
  Variant 1's URL-Rewrite SPA rule has no equivalent here because it isn't needed.
- **No `X-Forwarded-*` plumbing.** The app builds absolute links from `APP_BASE_URL` and
  never reads the request scheme, so there's no `HTTP_X_FORWARDED_PROTO` server variable to
  configure (it was belt-and-suspenders in Variant 1).
- **Create the log folder first.** HttpPlatformHandler writes the *file* but does **not**
  create its parent directory (auto-creation is an ASP.NET Core Module behaviour — a
  different module). `mkdir C:\apps\drilling\logs`, then grant the pool identity write:
  `icacls C:\apps\drilling\logs /grant "<DOMAIN\svc-drilling>:(OI)(CI)M"` (or
  `IIS AppPool\DrillingPool` if you kept the default pool identity). A missing folder logs a
  path-not-found warning (`ErrorCode -2147024893`) to the Windows **Application** event log and
  you get *no* stdout; a permissions miss shows `0x80070005`. The value is a **literal**
  filename — no PID/timestamp is appended (unlike ANCM) — hence the `.log` extension.
- **`stdoutLogFile` is for bring-up only** — it grows unbounded. Once healthy, set
  `stdoutLogEnabled="false"` and rely on the app's own `LOG_LEVEL` logging.
- **Keep secrets in the ACL'd `.env`** (B.2), *not* in `<environmentVariables>` — anyone
  who can read the site root can read `web.config`.
- **`.env` and app code now sit under the site root**, which would normally be a red flag.
  It's safe here only because the `path="*"` handler routes *every* request to uvicorn, so
  IIS never static-serves a file from that folder — nothing under it is reachable over HTTP.
  Keep the B.2 `icacls` lockdown on `.env` as defence-in-depth, and don't add a static-file
  handler that could bypass the catch-all.

### B.7 Docker Desktop alternative
If IT standardises on containers: the existing **Linux** backend image runs under
Docker Desktop with the **WSL2 (Linux container) backend** — the §4b/§4c `docker build`
/ `docker run` / `docker exec … alembic upgrade head` commands work verbatim. Caveats:
Docker Desktop **licensing** applies to larger orgs, and Docker Desktop is a workstation
tool — for a long-running Server install, prefer the native path (B.2–B.4).

### B.8 Day-2 on Windows (deltas from §9)
- **Restart after upgrade:**
  - *ARR variant:* `nssm restart DrillingBackend` (or `Restart-Service DrillingBackend`).
  - *HttpPlatformHandler variant:* recycle the pool — `Restart-WebAppPool DrillingPool`
    (editing/touching `web.config` also restarts the process).
- **Logs:**
  - *ARR variant:* point NSSM at a log file — `nssm set DrillingBackend AppStdout C:\apps\drilling\logs\out.log` (and `AppStderr`).
  - *HttpPlatformHandler variant:* `stdoutLogFile` captures startup; for steady state rely
    on the app's own logging (set `stdoutLogEnabled="false"`).
  - Either way, raise `LOG_LEVEL=DEBUG` in `.env` to diagnose, then back to `INFO`.
- **Upgrades:** pull code → `.venv\Scripts\python -m pip install -r requirements.txt` (if deps changed) → `.venv\Scripts\alembic upgrade head` → restart (per above) → rebuild & recopy the frontend (to the site root for ARR, or to `STATIC_DIR` for HttpPlatformHandler).

---

## Appendix C — Single-process deploy on a locked-down host (no IIS / ARR / NSSM)

Use this when the host **can't install** the usual web-hosting pieces — IIS's
**ARR**/**HttpPlatformHandler** (the reverse-proxy modules) or a service installer
like **NSSM** (often blocked by EDR/AV policy). Instead, **uvicorn serves
everything itself**: the `/api` backend, the built frontend, the SPA fallback, *and*
TLS — one process, inherently single-origin. It's run as a Windows service via
**pywin32** (a pip package, no separate installer). Fine for an internal app at this
scale; for high traffic, prefer Appendix B's IIS path.

> **No IIS means no Windows Integrated Auth.** This single-process shape can't perform
> the Negotiate/Kerberos handshake, so it can't authenticate real users on its own. Use
> it only with `DEV_MODE=true` for testing (Appendix D), or behind a separate
> Windows-Auth proxy that injects `PROXY_USER_HEADER`. For production SSO, use the IIS
> path (Appendix B, Variant 1).

### C.1 Install the backend (Python 3.11–3.14 + pywin32)
From `backend\` (any Python 3.11–3.14 works — see B.1; `py -3.14` is fine on the host):
```bat
py -3.14 -m venv .venv
.venv\Scripts\python -m pip install --upgrade pip
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python -m pip install pywin32
```

### C.2 Build the frontend and point the backend at it
Build per §5 (`npm ci && npm run build`), copy `frontend\dist\` to e.g.
`C:\apps\drilling\web`, then in `backend\.env` add the §4a keys **plus**:
```ini
:: uvicorn serves this folder as the SPA (assets + index.html fallback).
STATIC_DIR=C:\apps\drilling\web
:: Driver 17 is fine — match what's installed and force encryption explicitly:
DATABASE_URL=mssql+aioodbc://<DB_USER>:<DB_PASS>@<DB_HOST>:1433/drilling_sequence?driver=ODBC+Driver+17+for+SQL+Server&Encrypt=yes&TrustServerCertificate=no
```
Because it's single-origin, `ALLOWED_ORIGINS`/`APP_BASE_URL` are just your one HTTPS
URL, e.g. `https://drilling.renaissanceafrica.com`.

### C.3 TLS certificate in PEM form
uvicorn needs the cert + key as **PEM** files (Windows certs are usually a `.pfx`).
Convert once (OpenSSL, or PowerShell), then keep them readable only by the service
account:
```bat
:: with OpenSSL:
openssl pkcs12 -in drilling.pfx -clcerts -nokeys -out C:\apps\drilling\certs\server.crt
openssl pkcs12 -in drilling.pfx -nocerts -nodes  -out C:\apps\drilling\certs\server.key
icacls C:\apps\drilling\certs\server.key /inheritance:r /grant:r "<DOMAIN\svc-drilling>:R" "Administrators:F"
```

### C.4 Create the database tables (once, and after each upgrade)
```bat
cd backend
.venv\Scripts\alembic upgrade head
```
With Integrated auth, run this *as the service account* (`runas /user:<DOMAIN\svc-drilling> cmd`).

### C.5 Install and start the service
Set the run-time env vars the service reads (machine-wide via `setx /m`, or in the
service account profile), then install. **Run elevated, with the venv's python:**
```bat
setx /m DS_PORT 443
setx /m DS_SSL_CERTFILE C:\apps\drilling\certs\server.crt
setx /m DS_SSL_KEYFILE  C:\apps\drilling\certs\server.key

cd backend
.venv\Scripts\python windows_service.py install
sc.exe config DrillingSequence start= auto
sc.exe failure DrillingSequence reset= 86400 actions= restart/5000/restart/5000/restart/5000
:: Run the service as the domain account (needed for Integrated SQL auth):
sc.exe config DrillingSequence obj= "<DOMAIN\svc-drilling>" password= "<password>"
.venv\Scripts\python windows_service.py start
```
(`windows_service.py` documents all of this at the top of the file.)

### C.6 Open the firewall and smoke-test
```powershell
New-NetFirewallRule -DisplayName "Drilling Sequence HTTPS" -Direction Inbound -Protocol TCP -LocalPort 443 -Action Allow
Invoke-RestMethod https://<your-app-dns>/api/health      # -> {"status":"ok"}
```
Then browse to `https://<your-app-dns>` and run the §7 smoke test. There's no IIS, so
there's no HTTP→HTTPS redirect — share the `https://` URL (or add a tiny redirect later).

### C.7 Day-2
- **Restart:** `Restart-Service DrillingSequence` (or `windows_service.py stop` / `start`).
- **Logs:** uvicorn writes to stdout; the service's own events land in the Windows
  **Application** event log. Raise `LOG_LEVEL=DEBUG` in `.env` to diagnose, then back to INFO.
- **Upgrades:** pull code → `pip install -r requirements.txt` (if deps changed) →
  `alembic upgrade head` → `Restart-Service DrillingSequence` → rebuild & recopy `dist\`.

> If IT *can* approve **ARR** (a Microsoft-signed module) later, switch to Appendix B's
> IIS path (Variant 1) to get real Windows sign-in — unset `STATIC_DIR` and configure the
> Windows-Auth header injection (§2 / B.6).

---

## Appendix D — Test / staging on DEV_MODE (no sign-in, no TLS)

Use this to stand the app up for **colleagues to click around** before SSO and the
production move are ready — the "share a link so others can test" case. It's the
single-process shape of Appendix C, but with `DEV_MODE` on, so you skip the Windows
Integrated Auth setup (§2) and the TLS certificate entirely.

> **What `DEV_MODE` actually does:** it turns authentication **off**. Every request
> is treated as one fixed, built-in **admin** user — there is no login and no token
> check, so **anyone who can reach the URL has full admin access.** Only ever run
> this on the **internal network**, never internet-facing, and share the link only
> with your intended testers.

### D.1 What this can and can't test
**Can test** — the UI, the sequence chart, CSV/Excel import, readiness gates, the
print/PDF export, navigation, dashboards: anything that doesn't depend on *who* the
user is.

**Cannot test** — the **review → approval workflow.** Every tester is the *same*
user, and a revision's creator may not sign their own work (an integrity rule with
no admin bypass), and submit is blocked when there's only one eligible approver — so
a single shared identity dead-ends sign-off. The multi-person governance core can
only be exercised with **real Windows sign-in and 2–3 distinct accounts** (i.e. via the
IIS Windows-Auth setup, §2). Don't spend time trying to approve anything under `DEV_MODE`.

### D.2 Build the frontend with login off
The dev-mode flag is baked in at build time, so the **frontend** must also be built with
login off. In `frontend\.env.production` (or `.env`):
```ini
VITE_DEV_MODE=true
```
Then `npm ci && npm run build` (per §5) and copy `frontend\dist\` to e.g.
`C:\apps\drilling\web`.

### D.3 Backend env — no Windows-Auth block, no production guard
`backend\.env` with the §4a keys **minus** the `PROXY_*` section, plus:
```ini
:: Auth OFF — single shared admin user. Internal network only.
DEV_MODE=true

:: Leave ENVIRONMENT unset (or "development"). Setting it to "production" makes the
:: app refuse to start while DEV_MODE is on — that's the fail-closed guard working.
:: ENVIRONMENT=

:: uvicorn serves the built frontend itself (single origin) — point at D.2's output.
STATIC_DIR=C:\apps\drilling\web

:: Your test DB. SQLite needs no server; or point at a throwaway MSSQL test DB (§4a).
DATABASE_URL=sqlite+aiosqlite:///./dev.db
```
Tables: on the **SQLite** dev DB the app creates them on startup; on a **MSSQL** test
DB run `.venv\Scripts\alembic upgrade head` once (per §4c / B.3).

### D.4 Run it on the network and share the link
No TLS is needed for a dev test, so plain HTTP is fine on the internal
network. The one change from the localhost smoke test is `--host 0.0.0.0`, which
makes it reachable from other machines:
```bat
cd backend
.venv\Scripts\python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```
Open the firewall for the port, then share **`http://<server-name-or-IP>:8000/`**:
```powershell
New-NetFirewallRule -DisplayName "Drilling Sequence (DEV test)" -Direction Inbound -Protocol TCP -LocalPort 8000 -Action Allow
```
To survive logoff/reboot, run it as a service the same way as Appendix C
(`windows_service.py`) — just without the TLS/443 env vars. For an ad-hoc test,
leaving the console window running is fine.

### D.5 When you're ready for SSO / production
No app changes — only config. Rebuild the frontend with `VITE_DEV_MODE=false` (§5); set
the backend to `DEV_MODE=false`, `ENVIRONMENT=production`, the `PROXY_*` keys and the
real `DATABASE_URL` (§4a); and front it with **IIS doing Windows Integrated Auth**
(Appendix B, Variant 1 — §2). Then the multi-person approval flow becomes testable with
distinct Windows accounts.

---

*Open items still owned by IT before go-live are tracked in
[`mssql-migration.md`](./mssql-migration.md) §5 (auth method, server cert,
collation, host/port).*
