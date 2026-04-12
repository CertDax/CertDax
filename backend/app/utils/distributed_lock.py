"""Database-based distributed locking for multi-instance deployments."""

import os
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy.exc import IntegrityError

from app.database import SessionLocal
from app.models.distributed_lock import DistributedLock

# Unique instance ID generated at process start
_instance_id = f"{os.getpid()}@{uuid.uuid4().hex[:8]}"


def get_instance_id() -> str:
    return _instance_id


def try_acquire_lock(lock_name: str, ttl_seconds: int = 300) -> bool:
    """Try to acquire a named lock. Returns True if acquired, False if held by another instance."""
    db = SessionLocal()
    try:
        now = datetime.now(timezone.utc)
        lock = db.query(DistributedLock).filter(DistributedLock.lock_name == lock_name).first()

        if lock is None:
            # No lock exists yet — create it
            lock = DistributedLock(
                lock_name=lock_name,
                locked_by=_instance_id,
                locked_at=now,
                expires_at=now + timedelta(seconds=ttl_seconds),
            )
            db.add(lock)
            try:
                db.commit()
                return True
            except IntegrityError:
                db.rollback()
                return False

        # Lock exists — check if expired or owned by us
        if lock.expires_at < now or lock.locked_by == _instance_id:
            lock.locked_by = _instance_id
            lock.locked_at = now
            lock.expires_at = now + timedelta(seconds=ttl_seconds)
            db.commit()
            return True

        return False
    except Exception:
        db.rollback()
        return False
    finally:
        db.close()


def release_lock(lock_name: str) -> None:
    """Release a lock we hold."""
    db = SessionLocal()
    try:
        lock = (
            db.query(DistributedLock)
            .filter(
                DistributedLock.lock_name == lock_name,
                DistributedLock.locked_by == _instance_id,
            )
            .first()
        )
        if lock:
            db.delete(lock)
            db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()
