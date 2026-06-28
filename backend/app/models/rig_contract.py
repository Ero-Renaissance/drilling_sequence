import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

# Workflow status the planner sets explicitly. Dates only become binding
# (i.e. drive the rig-level expiry alarm) when status is "Completed" — for the
# other states the rig contract is still a workflow item, not an in-force
# agreement.
CONTRACT_STATUSES = ("N/A", "Not Started", "In Progress", "Completed")


class RigContract(Base):
    """A drilling rig contract — a workflow item with dates that become binding once Completed."""

    __tablename__ = "rig_contracts"
    __table_args__ = (
        UniqueConstraint("project_id", "rig_name", name="uq_rig_contract_project_rig"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    rig_name: Mapped[str] = mapped_column(String(128), nullable=False)
    status: Mapped[str] = mapped_column(
        String(32), nullable=False, server_default="Not Started"
    )
    contract_start: Mapped[date | None] = mapped_column(Date, nullable=True)
    contract_end: Mapped[date | None] = mapped_column(Date, nullable=True)
    notes: Mapped[str | None] = mapped_column(String(1024), nullable=True)

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
