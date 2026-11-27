import os

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Settings come from the process environment first, then from this file.
    # DS_ENV_FILE names another file or, when set to an empty value, no file at
    # all: the test suite does that so it never reads a developer's local .env
    # (tests/__init__.py). It grants nothing new — an environment variable
    # already overrides any line of the file — and the guards below check
    # whatever was loaded, wherever it came from.
    model_config = SettingsConfigDict(
        env_file=os.environ.get("DS_ENV_FILE", ".env") or None, extra="ignore"
    )

    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/drilling_sequence"

    # Deployment environment. Set ENVIRONMENT=production in prod to enable fail-closed
    # checks below. Anything other than "production" is treated as a dev/test environment.
    environment: str = "development"

    # Root log level for the application logger (DEBUG/INFO/WARNING/ERROR).
    log_level: str = "INFO"

    # Reverse-proxy authentication (Windows Integrated Auth via IIS/ARR). The proxy
    # authenticates the browser with Negotiate/Kerberos and injects the resulting
    # account into this header on every proxied request (e.g. from IIS's LOGON_USER
    # server variable). Empty disables it (dev/test); REQUIRED in production by the
    # fail-closed guard below. The app MUST be reachable only via the proxy (bind
    # uvicorn to 127.0.0.1) so a client can't forge this header.
    proxy_user_header: str = ""

    # Optional shared secret between the proxy and this app. When set, every request
    # must also present it in the X-Proxy-Auth header or it's rejected — so a forged
    # user header is untrusted even if the app is somehow reached directly. Strongly
    # recommended in production as defense-in-depth beyond the loopback bind.
    proxy_shared_secret: str = ""

    # Optional. When set, a user's email is synthesized as "<username>@<domain>"
    # (the proxy gives us only the Windows account name). Needed for the revision-
    # decision notification to the creating planner to reach a real mailbox.
    user_email_domain: str = ""

    # Single-origin deploy without a reverse proxy: point STATIC_DIR at the
    # frontend's built `dist/` and uvicorn serves the SPA itself (assets + an
    # index.html fallback). Leave empty when a reverse proxy / the Vite dev
    # server serves the frontend (the default).
    static_dir: str = ""

    # When true: skip proxy authentication, inject a dev user. Never enable in
    # production — the validator below refuses to start if this is set there.
    dev_mode: bool = False

    # Pilot sign-in (docs/deployment-guide.md Appendix E): a stop-gap for a
    # deployment where Windows sign-in is not available yet. People on the
    # admin-kept list sign in with the part of their email before the "@"
    # (USER_EMAIL_DOMAIN supplies the rest); anyone who can edit or administer
    # must also give PILOT_PASSCODE. Submitting, signing and declining revisions
    # are refused while it is on (approvals_enabled) — a name anyone can type is
    # no basis for a signature. Off by default; it REPLACES the proxy header, so
    # the two can't be set together, and the guard below checks every piece.
    pilot_mode: bool = False
    # One shared passcode for planners, team editors and admins. >= 12 characters.
    pilot_passcode: str = ""
    # Signs the session cookie. >= 32 random characters; changing it signs
    # everyone out.
    pilot_session_secret: str = ""
    # How long a browser stays signed in.
    pilot_session_days: int = 30

    @property
    def is_production(self) -> bool:
        return self.environment.strip().lower() == "production"

    @property
    def approvals_enabled(self) -> bool:
        """Submit / sign / decline are available only under real sign-in."""
        return not self.pilot_mode

    @property
    def sign_in_mode(self) -> str:
        if self.dev_mode:
            return "dev"
        return "pilot" if self.pilot_mode else "sso"

    @model_validator(mode="after")
    def _guard_production(self) -> "Settings":
        """Fail closed: a misconfigured production deployment must crash on startup
        rather than silently bypass authentication."""
        if self.pilot_mode:
            self._guard_pilot()
        if self.is_production:
            if self.dev_mode:
                raise ValueError(
                    "DEV_MODE must be false when ENVIRONMENT=production — "
                    "dev mode bypasses authentication."
                )
            if not self.pilot_mode and not self.proxy_user_header.strip():
                raise ValueError(
                    "PROXY_USER_HEADER is required when ENVIRONMENT=production — "
                    "it names the header the authenticating reverse proxy injects "
                    "(or set PILOT_MODE with its passcode and session secret)."
                )
        return self

    def _guard_pilot(self) -> None:
        """Pilot sign-in is all-or-nothing in EVERY environment: a half-configured
        pilot must crash on startup, never run with a blank passcode or key."""
        if self.dev_mode:
            raise ValueError(
                "PILOT_MODE and DEV_MODE can't both be on — dev mode bypasses sign-in."
            )
        if self.proxy_user_header.strip():
            raise ValueError(
                "PILOT_MODE replaces PROXY_USER_HEADER — set one, not both."
            )
        if len(self.pilot_passcode) < 12:
            raise ValueError("PILOT_PASSCODE must be at least 12 characters in PILOT_MODE.")
        if len(self.pilot_session_secret) < 32:
            raise ValueError(
                "PILOT_SESSION_SECRET must be at least 32 characters in PILOT_MODE."
            )
        if self.pilot_passcode == self.pilot_session_secret:
            raise ValueError("PILOT_PASSCODE and PILOT_SESSION_SECRET must differ.")
        if not self.user_email_domain.strip():
            raise ValueError(
                "USER_EMAIL_DOMAIN is required in PILOT_MODE — people sign in with "
                "the part of their email before the @."
            )
        if not 1 <= self.pilot_session_days <= 90:
            raise ValueError("PILOT_SESSION_DAYS must be between 1 and 90.")

    # Rig fleet optimizer engine: "heuristic" (owned code, default) or "milp"
    # (exact solver — requires a solver library that must pass IT review before
    # adoption; until installed the API falls back to heuristic with a warning).
    optimizer_engine: str = "heuristic"

    # Admin access. admin_emails is the allowlist of global admins, matched against
    # a user's email OR their Windows username (comma-separated, case-insensitive).
    # Sign-in carries no role claims, so this is the login-time source of truth;
    # grants made on the Admin page are additive and preserved across logins.
    admin_emails: str = ""

    # Comma-separated origins: "http://localhost:5173,https://app.company.com"
    # Stored as str so pydantic-settings doesn't try to JSON-parse it from the .env file.
    allowed_origins: str = "http://localhost:5173"

    # Email notifications. Point smtp_host at the company internal SMTP relay.
    # Leaving smtp_host empty disables email entirely (notifications become no-ops),
    # so the app runs fine before IT provides relay details.
    smtp_host: str = ""
    smtp_port: int = 25
    smtp_from: str = "Renaissance Drilling Sequence <no-reply@renaissanceafrica.com>"
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_use_tls: bool = False
    # Public base URL used to build links back into the app in notification emails.
    app_base_url: str = "http://localhost:5173"

    @property
    def email_enabled(self) -> bool:
        return bool(self.smtp_host.strip())

    @property
    def allowed_origins_list(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]

    @property
    def admin_emails_list(self) -> list[str]:
        return [e.strip().lower() for e in self.admin_emails.split(",") if e.strip()]


settings = Settings()
