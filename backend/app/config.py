from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

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

    @property
    def is_production(self) -> bool:
        return self.environment.strip().lower() == "production"

    @model_validator(mode="after")
    def _guard_production(self) -> "Settings":
        """Fail closed: a misconfigured production deployment must crash on startup
        rather than silently bypass authentication."""
        if self.is_production:
            if self.dev_mode:
                raise ValueError(
                    "DEV_MODE must be false when ENVIRONMENT=production — "
                    "dev mode bypasses authentication."
                )
            if not self.proxy_user_header.strip():
                raise ValueError(
                    "PROXY_USER_HEADER is required when ENVIRONMENT=production — "
                    "it names the header the authenticating reverse proxy injects."
                )
        return self

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
