import logging

from app.database import SessionLocal
from app.models.notification import Notification

logger = logging.getLogger(__name__)


def create_notification(
    *,
    group_id: int | None,
    type: str,
    resource_type: str,
    resource_id: int | None = None,
    title: str,
    message: str,
    actor: str = "system",
    db=None,
):
    """Create an in-app notification. Pass db to use an existing session."""
    should_close = False
    if db is None:
        db = SessionLocal()
        should_close = True
    try:
        notif = Notification(
            group_id=group_id,
            type=type,
            resource_type=resource_type,
            resource_id=resource_id,
            title=title,
            message=message,
            actor=actor,
            is_read=False,
        )
        db.add(notif)
        db.commit()
    except Exception:
        logger.exception("Failed to create notification")
        db.rollback()
    finally:
        if should_close:
            db.close()
