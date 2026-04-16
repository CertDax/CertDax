from datetime import datetime
from pydantic import BaseModel


class NotificationResponse(BaseModel):
    id: int
    group_id: int | None = None
    type: str
    resource_type: str
    resource_id: int | None = None
    title: str
    message: str
    actor: str
    is_read: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class NotificationCountResponse(BaseModel):
    unread: int
