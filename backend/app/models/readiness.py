import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

CHECK_CODES = ("FDP", "LLI", "LOC", "FE", "FID", "EIA", "BUD", "CON")
CHECK_STATUSES = ("On Track", "Completed", "Behind", "N/A")


class ReadinessCheck(Base):
    """One readiness gate per activity — e.g. activity X needs BUD approved."""

    __tablename__ = "readiness_checks"
    __table_args__ = (
        UniqueConstraint("activity_id", "check_code", name="uq_readiness_activity_check"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    activity_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("activities.id", ondelete="CASCADE"), nullable=False, index=True
    )
    check_code: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="On Track")
    notes: Mapped[str | None] = mapped_column(String(512), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    activity: Mapped["Activity"] = relationship()  # type: ignore[name-defined]
