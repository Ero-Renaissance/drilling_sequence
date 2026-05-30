import uuid
from datetime import datetime

from pydantic import BaseModel, field_validator

from app.models.project import ProjectRole, ProjectStatus


class ProjectCreate(BaseModel):
    name: str
    field: str | None = None
    region: str | None = None

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Project name cannot be empty")
        return v.strip()


class ProjectClone(BaseModel):
    """Create a new project from an existing one. field/region default to the source's."""

    name: str
    field: str | None = None
    region: str | None = None

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Project name cannot be empty")
        return v.strip()


class ProjectUpdate(BaseModel):
    name: str | None = None
    field: str | None = None
    region: str | None = None
    status: ProjectStatus | None = None

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str | None) -> str | None:
        if v is not None and not v.strip():
            raise ValueError("Project name cannot be empty")
        return v.strip() if v else v


class ProjectMemberResponse(BaseModel):
    user_id: uuid.UUID
    role: ProjectRole
    user_name: str
    user_email: str

    model_config = {"from_attributes": True}

    @classmethod
    def from_member(cls, member: object) -> "ProjectMemberResponse":
        return cls(
            user_id=member.user_id,
            role=member.role,
            user_name=member.user.name,
            user_email=member.user.email,
        )


class ProjectResponse(BaseModel):
    id: uuid.UUID
    name: str
    field: str | None
    region: str | None
    status: ProjectStatus
    created_by: uuid.UUID
    created_at: datetime
    cloned_from_project_id: uuid.UUID | None = None
    members: list[ProjectMemberResponse] = []

    model_config = {"from_attributes": True}

    @classmethod
    def from_project(cls, project: object) -> "ProjectResponse":
        return cls(
            id=project.id,
            name=project.name,
            field=project.field,
            region=project.region,
            status=project.status,
            created_by=project.created_by,
            created_at=project.created_at,
            cloned_from_project_id=project.cloned_from_project_id,
            members=[ProjectMemberResponse.from_member(m) for m in project.members],
        )
