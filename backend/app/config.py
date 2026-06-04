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

    azure_tenant_id: str = ""
    azure_client_id: str = ""

    # Single-origin deploy without a reverse proxy: point STATIC_DIR at the
    # frontend's built `dist/` and uvicorn serves the SPA itself (assets + an
    # index.html fallback). Leave empty when a reverse proxy / the Vite dev
    # server serves the frontend (the default).
    static_dir: str = ""

    # When true: skip Azure AD, inject a dev user. Never enable in production —
    # the validator below refuses to start if this is set in a production environment.
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
                    "dev mode bypasses Azure AD authentication."
                )
            if not self.azure_tenant_id or not self.azure_client_id:
                raise ValueError(
                    "AZURE_TENANT_ID and AZURE_CLIENT_ID are required when "
                    "ENVIRONMENT=production."
                )
        return self

    # Admin access. Production source of truth is an Azure AD app role (admin_role)
    # carried in the token's "roles" claim. admin_emails is a bootstrap allowlist so
    # the first admins exist before the AD role is configured. Both are comma-separated.
    admin_emails: str = ""
    admin_role: str = "Admin"

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
