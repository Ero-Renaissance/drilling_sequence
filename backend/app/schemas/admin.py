import uuid

from pydantic import BaseModel, model_validator


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


class AdminUserUpdate(BaseModel):
    """Partial update — send only the flag(s) being changed."""

    is_admin: bool | None = None
    can_plan: bool | None = None

    @model_validator(mode="after")
    def _at_least_one_field(self) -> "AdminUserUpdate":
        if self.is_admin is None and self.can_plan is None:
            raise ValueError("Provide is_admin and/or can_plan")
        return self
