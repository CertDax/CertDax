from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class K8sOperator(Base):
    __tablename__ = "k8s_operators"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(100))
    operator_token_hash: Mapped[str | None] = mapped_column(String(64))
    namespace: Mapped[str | None] = mapped_column(String(255))
    deployment_name: Mapped[str | None] = mapped_column(String(255))
    cluster_name: Mapped[str | None] = mapped_column(String(255))
    operator_version: Mapped[str | None] = mapped_column(String(50))
    kubernetes_version: Mapped[str | None] = mapped_column(String(50))
    pod_name: Mapped[str | None] = mapped_column(String(255))
    node_name: Mapped[str | None] = mapped_column(String(255))
    cpu_usage: Mapped[str | None] = mapped_column(String(50))
    memory_usage: Mapped[str | None] = mapped_column(String(50))
    memory_limit: Mapped[str | None] = mapped_column(String(50))
    managed_certificates: Mapped[int] = mapped_column(Integer, default=0)
    ready_certificates: Mapped[int] = mapped_column(Integer, default=0)
    failed_certificates: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(20), default="offline")
    last_seen: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    recent_logs: Mapped[str | None] = mapped_column(Text, nullable=True)
    managed_certs_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    group_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("groups.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
