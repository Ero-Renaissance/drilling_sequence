import uuid

from pydantic import BaseModel, ConfigDict, Field, StrictBool, field_validator, model_validator


class AdminUserResponse(BaseModel):
    id: uuid.UUID
    name: str
    email: str
    is_admin: bool
    # Global planner grant — may create campaigns / hold the planner role.
    can_plan: bool
    project_count: int
    # True when this user's email is in the admin_emails allowlist: they keep admin
    # from config, so a manual "revoke" here would be re-granted at their next login.
    admin_via_allowlist: bool = False
    # Readiness teams this user may edit in every campaign (global team grants).
    teams: list[str] = []
    # False = blocked from signing in (Admin page).
    is_active: bool = True


class AdminUserUpdate(BaseModel):
    """Partial update — send only the flag(s) being changed."""

    is_admin: bool | None = None
    can_plan: bool | None = None
    # False blocks the person from signing in; True lets them back in.
    is_active: StrictBool | None = None

    @model_validator(mode="after")
    def _at_least_one_field(self) -> "AdminUserUpdate":
        if self.is_admin is None and self.can_plan is None and self.is_active is None:
            raise ValueError("Provide is_admin, can_plan and/or is_active")
        return self


class AdminUserCreate(BaseModel):
    """Add a person to the pilot sign-in list. `username` is the part of their
    email before the "@" — the name they will sign in with."""

    model_config = ConfigDict(extra="forbid")

    username: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9._-]+$")
    name: str = Field(min_length=1, max_length=256)

    @field_validator("username")
    @classmethod
    def _lowercase(cls, value: str) -> str:
        return value.lower()

    @field_validator("name")
    @classmethod
    def _trimmed(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Name is required")
        return value
