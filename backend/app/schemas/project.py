import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.models.project import ProjectRole, ProjectStatus, ReviewPolicy


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
    # Allow-listed to the ReviewPolicy enum; anything else → 422.
    review_policy: ReviewPolicy | None = None

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str | None) -> str | None:
        if v is not None and not v.strip():
            raise ValueError("Project name cannot be empty")
        return v.strip() if v else v


class PlannerAdd(BaseModel):
    """Add a co-planner to a campaign, identified by their sign-in email. The
    target must already exist (signed in at least once) and hold the global
    planner grant."""

    email: EmailStr = Field(max_length=256)


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


class ProjectLock(BaseModel):
    """Whether the campaign's plan is frozen, and why — drives the Revise Plan
    banner and the lock affordances. `reason="pending"` while a revision is in
    review/approval; `reason="approved"` once approved (the plan stays frozen until
    a planner reopens it via Revise Plan)."""

    locked: bool
    reason: Literal["pending", "approved"] | None = None
    revision_id: uuid.UUID | None = None
    rev_number: int | None = None
    rev_label: str | None = None


class ProjectApprovalSummary(BaseModel):
    """Compact plan-state for the campaign header chip and the lock banner:
    the latest revision's status plus approval-signature progress while one is
    pending. Display-only — the Approvals tab remains the authority on signer
    eligibility (separation of duties etc.)."""

    # draft | pending_review | pending_approval | approved | changes_requested
    # | rejected | discarded ("draft" = no revisions yet)
    status: str
    rev_number: int | None = None
    rev_label: str | None = None
    # Approval-stage signatures landed / designated approvers (kind="approver").
    signed: int = 0
    approvers: int = 0
    # What the CURRENT VIEWER can do about the pending revision — drives the
    # "awaiting your review/approval" banner. Mirrors the sign/review endpoint
    # gates (designated signer of the stage's kind, or admin — never the
    # revision's creator); null when there is nothing for this viewer to do.
    your_action: Literal["review", "approve"] | None = None


class ProjectResponse(BaseModel):
    id: uuid.UUID
    name: str
    field: str | None
    region: str | None
    status: ProjectStatus
    review_policy: ReviewPolicy = ReviewPolicy.optional
    created_by: uuid.UUID
    created_at: datetime
    cloned_from_project_id: uuid.UUID | None = None
    members: list[ProjectMemberResponse] = []
    # Populated on the detail endpoint only (None in the list response).
    lock: ProjectLock | None = None
    approval: ProjectApprovalSummary | None = None

    model_config = {"from_attributes": True}

    @classmethod
    def from_project(cls, project: object) -> "ProjectResponse":
        return cls(
            id=project.id,
            name=project.name,
            field=project.field,
            region=project.region,
            status=project.status,
            review_policy=project.review_policy,
            created_by=project.created_by,
            created_at=project.created_at,
            cloned_from_project_id=project.cloned_from_project_id,
            members=[ProjectMemberResponse.from_member(m) for m in project.members],
        )
