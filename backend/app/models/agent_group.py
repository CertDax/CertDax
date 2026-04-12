from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class AgentGroup(Base):
    __tablename__ = "agent_groups"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    group_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("groups.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    members: Mapped[list["AgentGroupMember"]] = relationship(
        "AgentGroupMember", back_populates="agent_group", cascade="all, delete-orphan"
    )


class AgentGroupMember(Base):
    __tablename__ = "agent_group_members"

    id: Mapped[int] = mapped_column(primary_key=True)
    agent_group_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("agent_groups.id", ondelete="CASCADE")
    )
    target_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("deployment_targets.id", ondelete="CASCADE")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    agent_group: Mapped[AgentGroup] = relationship(
        "AgentGroup", back_populates="members"
    )
    target: Mapped["DeploymentTarget"] = relationship("DeploymentTarget")
