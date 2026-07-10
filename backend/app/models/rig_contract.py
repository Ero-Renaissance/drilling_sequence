import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class RigContract(Base):
    """A drilling rig contract.

    A contract exists iff an end date is on file — the end date IS the record
    (it drives the expiry urgency everywhere). There is no draft/completed
    workflow state: tentative terms belong in ``notes``, and "no contract yet"
    is the absence of a row, not a status value.
    """

    __tablename__ = "rig_contracts"
    __table_args__ = (
        UniqueConstraint(
            "project_id", "rig_name", "terrain", name="uq_rig_contract_project_rig"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    rig_name: Mapped[str] = mapped_column(String(128), nullable=False)
    # Rig identity is (terrain, name) — see app/models/resource_registry.py. ""
    # (never NULL — NULLs are distinct in UNIQUE constraints) means "unassigned":
    # legacy rows and rigs whose terrain the registry can't resolve yet.
    terrain: Mapped[str] = mapped_column(String(16), nullable=False, server_default="")
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
