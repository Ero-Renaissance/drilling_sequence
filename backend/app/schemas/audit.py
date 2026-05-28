import uuid
from datetime import datetime

from pydantic import BaseModel


class AuditEntryResponse(BaseModel):
    id: uuid.UUID
    entity_type: str
    entity_id: uuid.UUID
    field: str
    old_value: str | None
    new_value: str | None
    user_name: str | None
    timestamp: datetime

    model_config = {"from_attributes": True}
