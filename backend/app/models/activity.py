import uuid
from datetime import date, datetime
from typing import Optional

from sqlalchemy import Date, DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Activity(Base):
    """One row of a drilling schedule — maps 1:1 to a CSV row after import."""

    __tablename__ = "activities"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Stable identity carried across clones: a cloned activity inherits its
    # source's lineage_id, so the same logical activity can be matched between
    # quarterly schedules (Q1 → Q2). NULL means "use my own id" (see snapshot).
    lineage_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True, index=True)

    # ── Mandatory ──────────────────────────────────────────────────────────────
    activity_type: Mapped[str] = mapped_column(String(256), nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)

    # ── Entity (well / item / task / name) ────────────────────────────────────
    well_name: Mapped[str | None] = mapped_column(String(256), nullable=True)

    # ── Resource (rig / team / equipment) ─────────────────────────────────────
    rig_name: Mapped[str | None] = mapped_column(String(256), nullable=True)

    # ── Project the well is tied to (a development project owns many wells).
    #    Named well_project: `project` is the relationship to the parent Project. ──
    well_project: Mapped[str | None] = mapped_column(String(256), nullable=True)

    # ── Grouping (project / group / category) — legacy free-text grouping ─────
    project_group: Mapped[str | None] = mapped_column(String(256), nullable=True)

    # ── Location ──────────────────────────────────────────────────────────────
    location: Mapped[str | None] = mapped_column(String(64), nullable=True)

    # ── Status / quality ──────────────────────────────────────────────────────
    risk: Mapped[str | None] = mapped_column(String(64), nullable=True)
    comment: Mapped[str | None] = mapped_column(String(512), nullable=True)
    plan_type: Mapped[str | None] = mapped_column(String(64), nullable=True)

    # Set when a planner closes a completed activity. Completed activities are
    # dropped when the project is cloned into the next quarter.
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # ── Audit ─────────────────────────────────────────────────────────────────
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    updated_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    locked_by_revision_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        # No ondelete (NOT "SET NULL"): MSSQL forbids a SET NULL FK here due to multiple
        # cascade paths (projects -> activities and projects -> revisions). Activities are
        # unlocked in application code, never via a DB cascade. See migration 004.
        ForeignKey("revisions.id"),
        nullable=True,
    )

    project: Mapped["Project"] = relationship()  # type: ignore[name-defined]
    updated_by_user: Mapped[Optional["User"]] = relationship(  # type: ignore[name-defined]
        foreign_keys=[updated_by], lazy="selectin"
    )

    @property
    def updated_by_name(self) -> str | None:
        return self.updated_by_user.name if self.updated_by_user else None
