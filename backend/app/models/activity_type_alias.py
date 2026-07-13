"""Remembered activity-type mappings — the import dialog's memory.

When a planner maps an unrecognised sheet value to a canonical activity type
and ticks "remember", the mapping lands here and every future upload resolves
it automatically (app/services/data_processor.py::resolve_activity_type).
Org-wide, not per-campaign: vocabulary is shared. Alias creation is a
governance event (it changes how future imports are read), recorded globally.
"""
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class ActivityTypeAlias(Base):
    __tablename__ = "activity_type_aliases"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # The normalized lookup key (normalize_activity_type_key) — unique so one
    # sheet wording can never map to two canonical types.
    alias_key: Mapped[str] = mapped_column(String(128), nullable=False, unique=True)
    # The wording as first seen on a sheet, for display in summaries.
    alias_display: Mapped[str] = mapped_column(String(128), nullable=False)
    # Must be a CANONICAL_ACTIVITY_TYPES member at write time (endpoint-enforced;
    # kept a plain string so a future catalogue rename can't strand rows).
    canonical: Mapped[str] = mapped_column(String(128), nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
