from __future__ import annotations

from datetime import datetime, timezone
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.certificate import Certificate
    from app.models.selfsigned import SelfSignedCertificate


class DeploymentTarget(Base):
    __tablename__ = "deployment_targets"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    hostname: Mapped[str] = mapped_column(String(255))
    agent_token_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    deploy_path: Mapped[str] = mapped_column(String(500), default="/etc/ssl/certs")
    reload_command: Mapped[str | None] = mapped_column(String(500), nullable=True)
    pre_deploy_script: Mapped[str | None] = mapped_column(Text, nullable=True)
    post_deploy_script: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="offline")
    last_seen: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    agent_os: Mapped[str | None] = mapped_column(String(50), nullable=True)
    agent_arch: Mapped[str | None] = mapped_column(String(50), nullable=True)
    agent_version: Mapped[str | None] = mapped_column(String(50), nullable=True)
    agent_ip: Mapped[str | None] = mapped_column(String(45), nullable=True)
    os_type: Mapped[str] = mapped_column(String(10), default="linux")  # linux or windows
    recent_logs: Mapped[str | None] = mapped_column(Text, nullable=True)
    group_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("groups.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    deployments: Mapped[list[CertificateDeployment]] = relationship(
        "CertificateDeployment", back_populates="target"
    )
    assigned_certificates: Mapped[list[AgentCertificate]] = relationship(
        "AgentCertificate", back_populates="target", cascade="all, delete-orphan"
    )


class AgentCertificate(Base):
    """Association between agents and their assigned certificates."""
    __tablename__ = "agent_certificates"

    id: Mapped[int] = mapped_column(primary_key=True)
    target_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("deployment_targets.id", ondelete="CASCADE")
    )
    certificate_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("certificates.id", ondelete="CASCADE"), nullable=True
    )
    self_signed_certificate_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("self_signed_certificates.id", ondelete="CASCADE"), nullable=True
    )
    auto_deploy: Mapped[bool] = mapped_column(default=True)
    deploy_format: Mapped[str] = mapped_column(String(10), default="crt")
    pending_removal: Mapped[bool] = mapped_column(default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    target: Mapped[DeploymentTarget] = relationship(
        "DeploymentTarget", back_populates="assigned_certificates"
    )
    certificate: Mapped[Certificate | None] = relationship("Certificate")
    self_signed_certificate: Mapped[SelfSignedCertificate | None] = relationship("SelfSignedCertificate")


class CertificateDeployment(Base):
    __tablename__ = "certificate_deployments"

    id: Mapped[int] = mapped_column(primary_key=True)
    certificate_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("certificates.id"), nullable=True
    )
    self_signed_certificate_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("self_signed_certificates.id"), nullable=True
    )
    target_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("deployment_targets.id")
    )
    common_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="pending")
    deploy_format: Mapped[str] = mapped_column(String(10), default="crt")
    deployed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    certificate: Mapped[Certificate | None] = relationship(
        "Certificate", back_populates="deployments"
    )
    self_signed_certificate: Mapped[SelfSignedCertificate | None] = relationship(
        "SelfSignedCertificate"
    )
    target: Mapped[DeploymentTarget] = relationship(
        "DeploymentTarget", back_populates="deployments"
    )
