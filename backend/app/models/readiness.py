import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

CHECK_CODES = ("FDP", "LLI", "LOC", "FE", "FID", "EIA", "BUD")
CHECK_STATUSES = ("On Track", "Completed", "Behind", "N/A")


class ProjectReadiness(Base):
    """One readiness gate per FIELD-DEVELOPMENT PROJECT (the "Project" column,
    ``Activity.well_project`` — e.g. "Bonga Phase 3"), NOT per activity.

    FDP / FID / EIA / BUD etc. are sanction gates for a field project as a whole:
    every well and activity under that project shares one FID, one EIA, one
    budget approval. Every activity in the project reads its gates from here
    (denormalised into snapshots).

    Scoped to the campaign (``project_id`` → projects) AND the field-project name
    so the same field-project name in two campaigns keeps independent readiness.
    """

    __tablename__ = "project_readiness"
    __table_args__ = (
        UniqueConstraint(
            "project_id", "well_project", "check_code", name="uq_project_readiness_gate"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # The CAMPAIGN (code: Project) this readiness belongs to.
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # The field-development project name (Activity.well_project). Matched exactly
    # as stored on the activity; activities with no project have no gates.
    well_project: Mapped[str] = mapped_column(String(256), nullable=False)
    check_code: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="On Track")
    notes: Mapped[str | None] = mapped_column(String(512), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
