# Drilling Sequence — pilot sign-in deployment checklist

**For:** the person deploying on the app server. About 20 minutes.
**What changes:** the app does its own sign-in, so IIS no longer signs people in.
**Full detail:** [deployment-guide.md](deployment-guide.md) Appendix E.

## Before you start

- [ ] Back up the database.
- [ ] Keep a copy of the current `backend\.env`.
- [ ] Get two values from the app owner: the **passcode** and their **email address**.

## Steps

1. **Get the code.** Pull `main` (commit `7f97dc7` or later). No new packages to install.

2. **Edit `backend\.env`.**
   - Remove these two lines if present. The app will not start with them:
     `PROXY_USER_HEADER`, `PROXY_SHARED_SECRET`
   - Keep `ENVIRONMENT=production` and `DEV_MODE=false`.
   - Add:
     ```ini
     PILOT_MODE=true
     PILOT_PASSCODE=<from the app owner, at least 12 characters>
     PILOT_SESSION_SECRET=<48 random characters, see below>
     PILOT_SESSION_DAYS=30
     USER_EMAIL_DOMAIN=renaissanceafrica.com
     ADMIN_EMAILS=<the app owner's email address>
     ```
   - `APP_BASE_URL` must be the address people actually open, including
     `https://` or `http://`.
   - A random secret, in PowerShell:
     ```powershell
     -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 48 | ForEach-Object { [char]$_ })
     ```

3. **Upgrade the database.** From `backend\` (as the service account if the
   database uses Windows authentication):
   ```bat
   .venv\Scripts\alembic upgrade head
   ```

4. **Rebuild the frontend.** `frontend\.env.production` must hold
   `VITE_DEV_MODE=false`. Then, from `frontend\`:
   ```bat
   npm ci
   npm run build
   ```
   Copy `frontend\dist\` over the folder it is served from today.

5. **IIS: let everyone through to the app.** IIS Manager → the site →
   Authentication:
   - **Anonymous Authentication = Enabled**
   - Windows Authentication = Disabled

   Leave `web.config` as it is.

6. **Restart the app**, the same way as after any upgrade (guide B.8).

Keep port 8000 closed to the network, as before.

## How to tell it worked

- [ ] The startup log has the line `PILOT SIGN-IN IS ON`.
- [ ] `https://<site>/api/auth/options` shows `"sign_in":"pilot"`.
- [ ] Opening the site shows a sign-in box ending in `@renaissanceafrica.com`.
- [ ] The app owner signs in with their name and the passcode, and can open the
      Admin page.

## If it does not work

| What you see | Cause | Fix |
|---|---|---|
| The app will not start; the log names a `PILOT_` setting or `PROXY_USER_HEADER` | `.env` is incomplete, or the old header line is still there | Step 2 |
| A Windows password prompt, or error 401 on every page | Anonymous Authentication is still disabled | Step 5 |
| Sign-in works, then the sign-in box comes straight back | `APP_BASE_URL` says `https://` but the site is opened over `http://` | Fix `APP_BASE_URL`, restart |
| Error 500, and the log says `Invalid column name 'is_active'` | The database upgrade was not run | Step 3 |
| Error 500 naming `HTTP_X_REMOTE_USER` | IIS server variable not allowed | [iis-signin-handover.md](iis-signin-handover.md) step 3 |

## Going back

Restore the saved `backend\.env`, set IIS Authentication back as it was, and
restart. The database upgrade can stay; the previous version of the app is not
affected by it.
