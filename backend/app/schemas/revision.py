import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.approver import ApproverSignStatus


class RevisionCreate(BaseModel):
    label: str | None = None
    # Planner's route choice when the project's review_policy is "optional":
    # True → technical review first, False → straight to approval. Ignored (forced)
    # when the policy is "required" or "off".
    request_review: bool | None = None


class SignRequest(BaseModel):
    role_label: str = "Approver"


class DecisionRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=2000)


class SignatureResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID | None
    user_name: str | None
    role_label: str
    signed_at: datetime

    model_config = {"from_attributes": True}


class RevisionResponse(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    rev_number: int
    label: str | None
    status: str
    # Convenience for the UI: "review" while pending_review, else "approval".
    stage: str = "approval"
    # True when this revision was routed through the technical-review stage.
    review_required: bool = False
    # True when review was available (policy "optional") but the planner skipped
    # it — surfaced so approvers can see review was bypassed.
    review_skipped: bool = False
    created_by_name: str | None
    created_at: datetime
    signatures: list[SignatureResponse]
    # Per-approver signing status — empty when no approvers are configured
    approver_status: list[ApproverSignStatus] = []
    # Per-reviewer signing status (review stage) — empty when no reviewers exist
    reviewer_status: list[ApproverSignStatus] = []
    # Set when a revision is rejected or sent back for changes
    decision_reason: str | None = None
    decision_by_name: str | None = None
    decision_at: datetime | None = None

    model_config = {"from_attributes": True}


class RevisionDetailResponse(RevisionResponse):
    snapshot_json: str
