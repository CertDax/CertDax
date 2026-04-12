from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class GroupShare(Base):
    """One-directional share: owner_group shares resource_type with target_group."""

    __tablename__ = "group_shares"
    __table_args__ = (
        UniqueConstraint(
            "owner_group_id", "target_group_id", "resource_type",
            name="uq_group_share",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_group_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("groups.id", ondelete="CASCADE"), index=True
    )
    target_group_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("groups.id", ondelete="CASCADE"), index=True
    )
    resource_type: Mapped[str] = mapped_column(String(50))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
