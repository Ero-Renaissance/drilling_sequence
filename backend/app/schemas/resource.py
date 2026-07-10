import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, StringConstraints

# Trimmed, bounded strings — identity names and class labels are short.
ResourceName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=256)
]
CapabilityClass = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)
]


class ResourceResponse(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    kind: str  # "rig" | "hwu"
    terrain: str  # "" = not terrain-bound (HWUs / unassigned)
    name: str
    capability_class: str | None
    is_placeholder: bool
    updated_at: datetime

    model_config = {"from_attributes": True}


class ResourceUpdate(BaseModel):
    """Edit the unit's attributes (never its identity — that's `rename`)."""

    capability_class: CapabilityClass | None = None
    is_placeholder: bool | None = None


class ResourceRename(BaseModel):
    """Rename-on-award: a placeholder slot matures into the contracted unit's
    real name (or a real unit is corrected). Identity terrain is unchanged."""

    new_name: ResourceName
