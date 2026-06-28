import uuid

from pydantic import BaseModel


class AdminUserResponse(BaseModel):
    id: uuid.UUID
    name: str
    email: str
    is_admin: bool
    project_count: int
    # True when this user's email is in the admin_emails allowlist: they keep admin
    # from config, so a manual "revoke" here would be re-granted at their next login.
    admin_via_allowlist: bool = False


class AdminUserUpdate(BaseModel):
    is_admin: bool
