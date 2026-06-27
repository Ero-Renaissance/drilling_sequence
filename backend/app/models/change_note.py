import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

# Which resource a change note describes. "general" is the single catch-all note
# for activities with no resource; rig/hwu notes are keyed by the resource name.
CHANGE_NOTE_KINDS = ("rig", "hwu", "general")


class ChangeNote(Base):
    """A planner-authored "what changed and why" note for one resource — the
    summary of a rig's activity changes vs the last sequence (the Excel's per-rig
    change blocks). Authored on the Compare page; snapshotted into the revision on
    submit so the approved plan records the rationale, not just the schedule.
    """

    __tablename__ = "change_notes"
    __table_args__ = (
        UniqueConstraint(
            "project_id", "kind", "resource_name", name="uq_change_note_project_kind_resource"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # "rig" | "hwu" | "general".
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    # The rig/HWU name; NULL for the single "general" (no-resource) note.
    resource_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    body: Mapped[str] = mapped_column(String(4000), nullable=False)

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
