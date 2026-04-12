from datetime import datetime

from sqlalchemy import Column, DateTime, Integer, String

from app.database import Base


class DistributedLock(Base):
    __tablename__ = "distributed_locks"

    id = Column(Integer, primary_key=True)
    lock_name = Column(String(100), unique=True, nullable=False, index=True)
    locked_by = Column(String(255), nullable=False)
    locked_at = Column(DateTime, nullable=False)
    expires_at = Column(DateTime, nullable=False)
