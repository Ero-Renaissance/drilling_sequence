import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class HwuContract(Base):
    """A Hydraulic Workover Unit contract — the HWU parallel to RigContract.

    Same shape and semantics: a contract exists iff an end date is on file;
    there is no draft/completed workflow state (see RigContract).
    """

    __tablename__ = "hwu_contracts"
    __table_args__ = (
        UniqueConstraint("project_id", "hwu_name", name="uq_hwu_contract_project_hwu"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    hwu_name: Mapped[str] = mapped_column(String(128), nullable=False)
    contract_start: Mapped[date | None] = mapped_column(Date, nullable=True)
    # Always set on rows written through the API (the upsert schema requires it);
    # nullable only so the column predates migration 024's purge gracefully.
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
