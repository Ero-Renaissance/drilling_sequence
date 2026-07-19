import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    false,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Revision(Base):
    __tablename__ = "revisions"
    __table_args__ = (
        # The rev-number sequence is the approval record's spine; assigning it is
        # a read-max-then-insert, so the DB — not the app — must be the authority
        # that two concurrent submits can't mint the same number.
        UniqueConstraint("project_id", "rev_number", name="uq_revision_project_number"),
        # At most ONE open (pending) revision per project. The submit handler's
        # pending-check is a read-then-insert with a wide await window; under
        # concurrency two submits could both pass it, so the DB is the authority.
        # Filtered/partial unique index — approved/rejected/discarded rows don't
        # collide (a project has many of those over its lifetime).
        Index(
            "uq_open_revision_per_project",
            "project_id",
            unique=True,
            mssql_where=text("status IN ('pending_review', 'pending_approval')"),
            sqlite_where=text("status IN ('pending_review', 'pending_approval')"),
            postgresql_where=text("status IN ('pending_review', 'pending_approval')"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    rev_number: Mapped[int] = mapped_column(Integer, nullable=False)
    label: Mapped[str | None] = mapped_column(String(256), nullable=True)
    snapshot_json: Mapped[str] = mapped_column(Text, nullable=False)
    # Per-resource change notes captured with the plan (JSON list of
    # {kind, resource_name, body}). Nullable: older revisions predate the feature.
    change_notes_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    # "pending_review" | "pending_approval" | "approved" | "rejected"
    # | "changes_requested" | "discarded". Free string (not a DB enum) so adding
    # the review stage needs no column migration.
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending_approval")
    # True when this revision was routed through the technical-review stage. Records
    # the resolved route so history shows whether review happened or was skipped.
    review_required: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=false(), default=False
    )
    # Frozen at submit: the optional-policy planner chose to skip the endorsement
    # stage. Stored (not derived from the live review_policy) so a later policy
    # change can't retroactively rewrite whether a historical revision reads
    # "skipped" — the approval record must not mutate.
    review_skipped: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=false(), default=False
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )
    # Recorded when a revision is rejected or sent back for changes.
    decision_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    # No ondelete (NOT "SET NULL"): created_by -> users is already SET NULL, and MSSQL
    # rejects a second cascade path from revisions to users. Users are never hard-
    # deleted (Azure AD sourced). See migration 009.
    decision_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    decision_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    signatures: Mapped[list["Signature"]] = relationship(
        back_populates="revision",
        lazy="selectin",
        cascade="all, delete-orphan",
        order_by="Signature.signed_at",
    )
    creator: Mapped["User | None"] = relationship(  # type: ignore[name-defined]
        foreign_keys=[created_by], lazy="selectin"
    )
    decider: Mapped["User | None"] = relationship(  # type: ignore[name-defined]
        foreign_keys=[decision_by], lazy="selectin"
    )

    @property
    def created_by_name(self) -> str | None:
        return self.creator.name if self.creator else None

    @property
    def decision_by_name(self) -> str | None:
        return self.decider.name if self.decider else None


class RevisionComment(Base):
    """One entry in a revision's deliberation thread.

    Lets a designated reviewer/approver (or the planner, or an admin) record
    context WITHOUT ending the pending state — signing carries no text and the
    decision reason only exists on reject/request-changes. Append-only (no
    update/delete anywhere), keyed to the revision so the discussion stays
    part of the approval record after resolution. Visible org-wide, like every
    other read in the app.
    """

    __tablename__ = "revision_comments"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    revision_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("revisions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # The capacity the author held WHEN POSTING ("Admin" / "Approver" /
    # "Reviewer" / "Planner") — matrices can change between cycles, so the
    # record keeps what was true at the time.
    author_role: Mapped[str] = mapped_column(String(32), nullable=False)
    # The revision's stage at post time ("review" | "approval") — reads
    # differently in the record ("raised during review" vs "at approval").
    stage: Mapped[str] = mapped_column(String(16), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    user: Mapped["User | None"] = relationship(lazy="selectin")  # type: ignore[name-defined]

    @property
    def user_name(self) -> str | None:
        return self.user.name if self.user else None


class Signature(Base):
    __tablename__ = "signatures"
    __table_args__ = (
        # One signature per user per stage per revision — the endpoint's
        # read-then-insert duplicate check alone is racy, and duplicate rows
        # would pollute the signature record and its integrity digest. NULL
        # user_id can't collide in practice: users are never hard-deleted
        # (Azure AD sourced), so SET NULL never fires.
        UniqueConstraint(
            "revision_id", "user_id", "stage", name="uq_signature_revision_user_stage"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    revision_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("revisions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    role_label: Mapped[str] = mapped_column(String(128), nullable=False)
    # "approval" (binding sign-off) | "review" (technical concurrence). Lets one
    # table hold both signature kinds; counting logic filters by stage so a review
    # signature is never miscounted as an approval. Default keeps old rows binding.
    stage: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default="approval", default="approval"
    )
    # The canonical attestation recorded at signing — the server-owned sentence
    # stating WHAT the signer declared they reviewed (stage wording + resolved
    # baseline). NULL only on signatures predating migration 027.
    attestation: Mapped[str | None] = mapped_column(String(512), nullable=True)
    signed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    revision: Mapped["Revision"] = relationship(back_populates="signatures")
    user: Mapped["User | None"] = relationship(lazy="selectin")  # type: ignore[name-defined]

    @property
    def user_name(self) -> str | None:
        return self.user.name if self.user else None
