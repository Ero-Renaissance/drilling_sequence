import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.approver import ApproverSignStatus


class RevisionCreate(BaseModel):
    # Bounded to the Revision.label column width — an overlong value must 422
    # here, not 500 at the database.
    label: str | None = Field(default=None, max_length=256)
    # Planner's route choice when the project's review_policy is "optional":
    # True → review first, False → straight to approval. Ignored (forced)
    # when the policy is "required" or "off".
    request_review: bool | None = None


class SignRequest(BaseModel):
    # Bounded to the Signature.role_label column width; the label is also woven
    # into audit details and the printed sign-off block.
    role_label: str = Field(default="Approver", min_length=1, max_length=128)
    # The signer's explicit declaration that they reviewed the revision. Must be
    # true — the server refuses an unattested signature (422) and records its
    # own canonical attestation text, so a client can't weaken the wording.
    attested: bool = False


class DecisionRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=2000)


class SignatureResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID | None
    user_name: str | None
    role_label: str
    # What the signer declared they reviewed (None on pre-attestation rows).
    attestation: str | None = None
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
    # SHA-256 fingerprint of the immutable content (snapshot + signatures), used as
    # the printed "Document ID" so a recipient can verify the PDF against the system
    # of record. See app/services/integrity.py.
    integrity_digest: str = ""

    model_config = {"from_attributes": True}


class ChangeNoteSnapshot(BaseModel):
    """One per-resource change note, frozen into the revision at submit."""

    kind: str
    resource_name: str | None = None
    body: str


class RevisionDetailResponse(RevisionResponse):
    snapshot_json: str
    # Per-resource change notes captured at submit (the planner's rationale),
    # frozen with the revision. Empty for revisions predating the feature.
    change_notes: list[ChangeNoteSnapshot] = []
