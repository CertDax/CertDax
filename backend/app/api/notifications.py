from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.api.deps import get_current_user
from app.models.notification import Notification
from app.models.user import User
from app.schemas.notification import NotificationCountResponse, NotificationResponse

router = APIRouter()


@router.get("", response_model=list[NotificationResponse])
def list_notifications(
    limit: int = 50,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(Notification)
    if not user.is_admin:
        query = query.filter(
            (Notification.group_id == user.group_id) | (Notification.group_id.is_(None))
        )
    return query.order_by(Notification.created_at.desc()).limit(limit).all()


@router.get("/unread-count", response_model=NotificationCountResponse)
def unread_count(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(Notification).filter(Notification.is_read == False)  # noqa: E712
    if not user.is_admin:
        query = query.filter(
            (Notification.group_id == user.group_id) | (Notification.group_id.is_(None))
        )
    return {"unread": query.count()}


@router.post("/mark-all-read")
def mark_all_read(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(Notification).filter(Notification.is_read == False)  # noqa: E712
    if not user.is_admin:
        query = query.filter(
            (Notification.group_id == user.group_id) | (Notification.group_id.is_(None))
        )
    query.update({"is_read": True})
    db.commit()
    return {"ok": True}


@router.post("/{notification_id}/read")
def mark_read(
    notification_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    notif = db.query(Notification).filter(Notification.id == notification_id).first()
    if not notif:
        return {"ok": False}
    if not user.is_admin and notif.group_id != user.group_id:
        return {"ok": False}
    notif.is_read = True
    db.commit()
    return {"ok": True}
