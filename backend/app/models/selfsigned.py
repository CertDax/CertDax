from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class SelfSignedCertificate(Base):
    __tablename__ = "self_signed_certificates"

    id: Mapped[int] = mapped_column(primary_key=True)
    common_name: Mapped[str] = mapped_column(String(255), index=True)
    san_domains: Mapped[str | None] = mapped_column(Text, nullable=True)
    organization: Mapped[str | None] = mapped_column(String(255), nullable=True)
    organizational_unit: Mapped[str | None] = mapped_column(String(255), nullable=True)
    country: Mapped[str | None] = mapped_column(String(2), nullable=True)
    state: Mapped[str | None] = mapped_column(String(255), nullable=True)
    locality: Mapped[str | None] = mapped_column(String(255), nullable=True)
    key_type: Mapped[str] = mapped_column(String(10), default="rsa")  # rsa or ec
    key_size: Mapped[int] = mapped_column(Integer, default=4096)  # RSA bits or EC curve size
    validity_days: Mapped[int] = mapped_column(Integer, default=365)
    is_ca: Mapped[bool] = mapped_column(Boolean, default=False)
    auto_renew: Mapped[bool] = mapped_column(Boolean, default=False)
    renewal_threshold_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    custom_oids: Mapped[str | None] = mapped_column(Text, nullable=True)
    certificate_pem: Mapped[str | None] = mapped_column(Text, nullable=True)
    private_key_pem_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    issued_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
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
