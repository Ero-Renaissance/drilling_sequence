# Open Tickets

Deployment and application issues found in the field, awaiting a fix. Move
resolved entries to the **Closed** section at the bottom with the fix reference.

---

## DS-002 — uvicorn reachable directly on :8000 (bypasses IIS auth)

- **Opened:** 2026-09-17 · **Severity:** High (security — header forgery /
  impersonation possible from the LAN) · **Status:** Open
- **Environment:** `phc-s-08081.spin-ng.local`.

**Symptom:** uvicorn access log shows client-workstation IPs connecting
directly (e.g. `10.34.154.150:60229`), and the backend warns
`Proxy user header 'X-Remote-User' ABSENT/EMPTY`. Requests are bypassing
IIS entirely, so no Windows auth and no stamped header.

**Risk:** the trust model assumes only IIS can reach uvicorn. With :8000 open
to the network, anyone on the LAN can send a forged `X-Remote-User` header and
impersonate any user.

**Fix (all three):**

1. Bind uvicorn to loopback: `--host 127.0.0.1` (NSSM `AppParameters`, or
   `DS_HOST=127.0.0.1` + `DS_PORT=8000` for `windows_service.py`).
2. Firewall: remove any dev-test allow rule for :8000; add an inbound block.
3. After silent sign-in works via :8083, enable the shared secret — uncomment
   `HTTP_X_PROXY_AUTH` in `deploy/iis/web.config` and set the matching
   `PROXY_SHARED_SECRET` in `backend\.env`.

**Verify:** `netstat -ano | findstr :8000` shows `127.0.0.1:8000` LISTENING;
`Test-NetConnection phc-s-08081.spin-ng.local -Port 8000` fails from a
workstation; the app still works via `:8083`.

---

## Closed

### DS-001 — Readiness update 404s for field-project names containing `+`

- **Opened:** 2026-09-17 · **Severity:** Medium (data-entry blocker for affected
  projects; no data corruption) · **Status:** Closed 2026-10-13
- **Environment:** `phc-s-08081.spin-ng.local` IIS/ARR front door → uvicorn.

**Symptom:** `PUT /api/projects/{id}/readiness/Egbema%20Node%20FOD%20%2B%20IOGD/FDP`
returns **404**, frontend shows "failed to update", backend logs nothing (the
request never reaches uvicorn).

**Root cause:** the frontend correctly percent-encodes the field-project name
(`+` → `%2B`) into the URL path (`frontend/src/api/readiness.ts`), and the
backend route `PUT /readiness/{well_project:path}/{check_code}`
(`backend/app/routers/readiness.py`) would accept it — but IIS **request
filtering** rejects any URL path containing `+`/`%2B` as a suspected
double-escape sequence (**404.11**) *before* the ARR rewrite rule runs.
App code is not at fault.

**Confirm:** IIS log `C:\inetpub\logs\LogFiles\W3SVC<id>\` shows
`sc-status sc-substatus` = `404 11` for the failing PUT.

**Fix options (in order of preference):**

1. **Preferred — move `well_project` out of the URL path into the request
   body:** `PUT /api/projects/{project_id}/readiness/{check_code}` with
   `{ "well_project": ..., "status": ... }`. Free-form user data in a path
   segment is the design smell (the `:path` converter was already a workaround
   for slashes in names like "Gbaran 31/30"); this eliminates the whole
   encoding/filtering class for every name, past and future, with no proxy
   dependency. Touches the route, `frontend/src/api/readiness.ts`, and tests.
2. Config-only: add `<security><requestFiltering allowDoubleEscaping="true" /></security>`
   to `deploy/iis/web.config` (section is delegated to site level — no 500.19
   risk). Safe here because the site serves no filesystem content (pure proxy;
   FastAPI does its own single decode), but leaves the path-encoding fragility
   in place.
3. ~~Reject `+` via input validation~~ — **rejected**: `+`/`/` are legitimate
   business names ("Egbema Node FOD + IOGD", "Gbaran 31/30"); the character is
   harmless to the app (parameterized SQL, JSX escaping); existing rows would
   need migration; and it's whack-a-mole as other characters trip IIS next.

**Workaround until fixed:** avoid `+` in field-project names, or rename the
affected project.

**Resolution (2026-10-13):** fix option 1 implemented. The route is now
`PUT /api/projects/{project_id}/readiness/{check_code}` with body
`{ "well_project", "status", "notes" }`; the URL path carries only the fixed
check code, so no user text reaches IIS request filtering. `well_project` is
bounded 1–256 chars and `notes` ≤ 512 in `CheckUpsert` (matching the columns).
The old `/readiness/{well_project:path}/{check_code}` route is removed.
Regression tests in `backend/tests/test_readiness.py` cover `/`, `+` and other
URL-significant characters. No IIS config change needed. Deploy backend and
frontend together; users with an old tab open must reload the page.
