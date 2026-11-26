# Windows sign-in for Drilling Sequence — one-page handover

**For:** whoever set up Windows sign-in on `api.authenticate.spin-ng.local`.
**Ask:** do the same on the Drilling Sequence IIS site. About 30 minutes.
**Full detail:** [deployment-guide.md](deployment-guide.md) §2 and Appendix B.6.

## What the app needs from IIS

IIS signs the user in with Windows, then forwards every request to the app on
`127.0.0.1:8000` with the signed-in account in the `X-Remote-User` header. The
app does the rest. No passwords, no app registration.

## Steps (run elevated on the app server; replace `SITE-NAME`)

`appcmd` is at `%windir%\system32\inetsrv\appcmd.exe`.

1. **Install the pieces** — Windows Authentication role service, URL Rewrite,
   and Application Request Routing (ARR).
   ```powershell
   Install-WindowsFeature Web-Windows-Auth
   ```
   Then IIS Manager → server node → Application Request Routing Cache →
   Server Proxy Settings → tick **Enable proxy**.

2. **Turn Windows sign-in on, anonymous off, kernel mode on** (site level).
   ```bat
   appcmd set config "SITE-NAME" -section:system.webServer/security/authentication/windowsAuthentication /enabled:true /useKernelMode:true /commit:apphost
   appcmd set config "SITE-NAME" -section:system.webServer/security/authentication/anonymousAuthentication /enabled:false /commit:apphost
   ```

3. **Allow the two header variables** (server level — they cannot go in `web.config`).
   ```bat
   appcmd set config -section:system.webServer/rewrite/allowedServerVariables /+"[name='HTTP_X_REMOTE_USER']" /commit:apphost
   appcmd set config -section:system.webServer/rewrite/allowedServerVariables /+"[name='HTTP_X_PROXY_AUTH']" /commit:apphost
   ```

4. **Copy [`deploy/iis/web.config`](../deploy/iis/web.config) into the site
   root**, unchanged. It holds one rule: forward everything to the app and set
   `X-Remote-User` from `{LOGON_USER}`.

5. **Keep the app private.** It must listen on `127.0.0.1:8000` only, with
   port 8000 blocked inbound. Otherwise anyone on the network can skip IIS and
   pretend to be another user (open ticket DS-002).
   ```powershell
   New-NetFirewallRule -DisplayName "Drilling Sequence - block 8000" -Direction Inbound -Protocol TCP -LocalPort 8000 -Action Block
   ```

App settings (`backend\.env`) — already described in the guide §4a:
`ENVIRONMENT=production`, `DEV_MODE=false`, `PROXY_USER_HEADER=X-Remote-User`,
`USER_EMAIL_DOMAIN=<company mail domain>`, `ADMIN_EMAILS=<admins>`.

## How to tell it worked

From a domain PC, open `https://<site>/api/auth/me`. It should show your own
name and email with no password prompt.

| What you see | Cause | Fix |
|---|---|---|
| Error 500.19, "section is locked" | Auth settings were put in `web.config` | Use the file from step 4 unchanged; do steps 2–3 with the commands above |
| Error 500 naming `HTTP_X_REMOTE_USER` | Step 3 not done | Run step 3 |
| 401 on everything; app log says `X-Remote-User ABSENT/EMPTY` | Anonymous still on, or kernel mode off | Rerun step 2 |
| A username/password prompt | Site is not in the browser's Local Intranet zone | Add the site URL to the zone (usually by group policy) |
| `netstat -ano \| findstr :8000` shows `0.0.0.0:8000` | App is open to the network | Step 5 |

## Two questions for that team

1. **Is each person's Windows username the part of their email before the `@`?**
   The app builds the email as `username@<mail domain>`, and approvers are
   matched by email. If the two differ, tell us — approvers must then be listed
   by the built address, or the app needs a small change.
2. **Is the site URL already in the Local Intranet zone by group policy?** If
   not, who can add it?
