import uuid
from datetime import datetime

from pydantic import BaseModel


class ViewerResponse(BaseModel):
    user_id: uuid.UUID
    user_name: str
    last_seen_at: datetime

    model_config = {"from_attributes": True}
