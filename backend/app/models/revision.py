import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, false
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Revision(Base):
    __tablename__ = "revisions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    rev_number: Mapped[int] = mapped_column(Integer, nullable=False)
    label: Mapped[str | None] = mapped_column(String(256), nullable=True)
    snapshot_json: Mapped[str] = mapped_column(Text, nullable=False)
    # "pending_review" | "pending_approval" | "approved" | "rejected"
    # | "changes_requested" | "discarded". Free string (not a DB enum) so adding
    # the review stage needs no column migration.
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending_approval")
    # True when this revision was routed through the technical-review stage. Records
    # the resolved route so history shows whether review happened or was skipped.
    review_required: Mapped[bool] = mapped_column(
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
    decision_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
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


class Signature(Base):
    __tablename__ = "signatures"

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
    signed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    revision: Mapped["Revision"] = relationship(back_populates="signatures")
    user: Mapped["User | None"] = relationship(lazy="selectin")  # type: ignore[name-defined]

    @property
    def user_name(self) -> str | None:
        return self.user.name if self.user else None
