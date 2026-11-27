import uuid

from pydantic import BaseModel, ConfigDict, Field


class UserResponse(BaseModel):
    id: uuid.UUID
    name: str
    email: str
    is_admin: bool = False
    # Global planner grant — may create campaigns / hold the planner role.
    can_plan: bool = False
    # Readiness teams this user may edit (global team grants) — drives the UI's
    # default lens and which readiness dots are editable. The API stays the authority.
    teams: list[str] = []

    model_config = {"from_attributes": True}


class SignInRequest(BaseModel):
    """Pilot sign-in. `username` is the part of the email before the "@" (the
    full company address is accepted too); `passcode` is required for anyone who
    can edit or administer and must be left out by everyone else."""

    model_config = ConfigDict(extra="forbid")

    username: str = Field(min_length=1, max_length=320)
    passcode: str | None = Field(default=None, min_length=1, max_length=256)


class SignInOptions(BaseModel):
    """What the sign-in screen needs before anyone is signed in. Public."""

    # "sso" (Windows sign-in at the proxy), "pilot" (name + passcode) or "dev".
    sign_in: str
    # Shown after the name box in pilot mode; None otherwise.
    email_domain: str | None = None
    # False hides submit / sign / decline (the server refuses them too).
    approvals_enabled: bool = True
    # How long a pilot sign-in lasts; None outside pilot mode.
    session_days: int | None = None
