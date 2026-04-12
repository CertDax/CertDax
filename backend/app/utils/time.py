from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from app.database import SessionLocal


def format_now() -> str:
    """Return the current time formatted in the admin-configured timezone."""
    from app.models.app_settings import AppSettings

    db = SessionLocal()
    try:
        s = db.query(AppSettings).first()
        tz_name = s.timezone if s and s.timezone else "UTC"
    finally:
        db.close()

    try:
        tz = ZoneInfo(tz_name)
    except Exception:
        tz = timezone.utc

    return datetime.now(tz).strftime("%Y-%m-%d %H:%M:%S")


def format_dt(dt: datetime) -> str:
    """Format an existing datetime in the admin-configured timezone."""
    from app.models.app_settings import AppSettings

    db = SessionLocal()
    try:
        s = db.query(AppSettings).first()
        tz_name = s.timezone if s and s.timezone else "UTC"
    finally:
        db.close()

    try:
        tz = ZoneInfo(tz_name)
    except Exception:
        tz = timezone.utc

    return dt.astimezone(tz).strftime("%Y-%m-%d %H:%M:%S")
