from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class K8sDeployment(Base):
    """A certificate deployment request for a K8s operator.

    Created from the dashboard UI; the operator picks these up via the
    heartbeat response and creates the corresponding CertDaxCertificate CRs.
    """

    __tablename__ = "k8s_deployments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    operator_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("k8s_operators.id", ondelete="CASCADE"), nullable=False
    )
    certificate_id: Mapped[int] = mapped_column(Integer, nullable=False)
    certificate_type: Mapped[str] = mapped_column(String(20), default="selfsigned")
    secret_name: Mapped[str] = mapped_column(String(255), nullable=False)
    namespace: Mapped[str] = mapped_column(String(255), default="default")
    sync_interval: Mapped[str] = mapped_column(String(20), default="1h")
    include_ca: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
