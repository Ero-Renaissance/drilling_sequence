"""The resource registry — one row per PHYSICAL unit (rig or HWU) per campaign.

This is the authority for resource identity (docs/rig-registry-spec.md):

- **Rig** identity is (kind, terrain, name): rig classes are terrain-locked
  (a land rig can't float, a swamp barge can't drill on land), and the fleet
  reuses class-style names per terrain, so a LAND "10K Rig 1" and a SWAMP
  "10K Rig 1" are two different physical rigs.
- **HWU** identity is (kind, name): HWUs are modular and move across terrains
  (spec decision Q1), so their `terrain` is the empty sentinel.

`terrain` uses "" (never NULL) for "not terrain-bound" — NULLs are mutually
distinct inside UNIQUE constraints on every backend we target, which would
silently break identity uniqueness for HWUs.

`name` keeps the display casing the planner first used; `name_key` is the
trimmed, lowercased form the unique constraint and all lookups use, so
"10k rig 3" and "10K Rig 3" can never become two units.

`is_placeholder` marks a planned-but-unprocured slot (e.g. "10K Rig 3" known
only by capability class). It is cleared by rename-on-award. Placeholders are
expected to have no contract — the dashboard turns that absence into a
procurement early warning rather than an error.
"""
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

RESOURCE_KINDS = ("rig", "hwu")


def normalize_resource_name(name: str) -> str:
    """The canonical lookup key for a resource name (trimmed, case-folded)."""
    return name.strip().lower()


class ResourceRecord(Base):
    __tablename__ = "resource_registry"
    __table_args__ = (
        UniqueConstraint(
            "project_id", "kind", "terrain", "name_key", name="uq_resource_identity"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[str] = mapped_column(String(8), nullable=False)  # rig | hwu
    # LAND / SWAMP / OFFSHORE for rigs; "" for HWUs (mobile) and for rigs whose
    # activities carry no location.
    terrain: Mapped[str] = mapped_column(String(16), nullable=False, server_default="")
    name: Mapped[str] = mapped_column(String(256), nullable=False)
    name_key: Mapped[str] = mapped_column(String(256), nullable=False)
    # Capability class, e.g. "10K", "15K" — an attribute, never identity.
    capability_class: Mapped[str | None] = mapped_column(String(64), nullable=True)
    is_placeholder: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="0"
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
