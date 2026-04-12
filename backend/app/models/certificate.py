from __future__ import annotations

from datetime import datetime, timezone
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.deployment import CertificateDeployment
    from app.models.provider import DnsProvider


class CertificateAuthority(Base):
    __tablename__ = "certificate_authorities"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    directory_url: Mapped[str] = mapped_column(String(500), unique=True)
    is_staging: Mapped[bool] = mapped_column(Boolean, default=False)
    account_key_pem: Mapped[str | None] = mapped_column(Text, nullable=True)
    account_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    contact_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    eab_kid: Mapped[str | None] = mapped_column(String(500), nullable=True)
    eab_hmac_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    group_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("groups.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    certificates: Mapped[list[Certificate]] = relationship(back_populates="ca")


class Certificate(Base):
    __tablename__ = "certificates"

    id: Mapped[int] = mapped_column(primary_key=True)
    common_name: Mapped[str] = mapped_column(String(255), index=True)
    san_domains: Mapped[str | None] = mapped_column(Text, nullable=True)
    ca_id: Mapped[int] = mapped_column(Integer, ForeignKey("certificate_authorities.id"))
    dns_provider_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("dns_providers.id"), nullable=True
    )
    challenge_type: Mapped[str] = mapped_column(String(20), default="dns-01")
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    certificate_pem: Mapped[str | None] = mapped_column(Text, nullable=True)
    private_key_pem_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    chain_pem: Mapped[str | None] = mapped_column(Text, nullable=True)
    csr_pem: Mapped[str | None] = mapped_column(Text, nullable=True)
    issued_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    auto_renew: Mapped[bool] = mapped_column(Boolean, default=True)
    last_renewal_attempt: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    custom_oids: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    group_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("groups.id"), nullable=True
    )
    created_by_user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=True
    )
    modified_by_user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    ca: Mapped[CertificateAuthority] = relationship(back_populates="certificates")
    dns_provider: Mapped[DnsProvider | None] = relationship("DnsProvider")
    deployments: Mapped[list[CertificateDeployment]] = relationship(
        "CertificateDeployment", back_populates="certificate"
    )
