from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class OidcSettings(Base):
    __tablename__ = "oidc_settings"

    id: Mapped[int] = mapped_column(primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    provider_name: Mapped[str] = mapped_column(String(50), default="oidc")  # authentik, keycloak, entra, oidc
    display_name: Mapped[str] = mapped_column(String(100), default="SSO")
    client_id: Mapped[str] = mapped_column(String(255))
    client_secret_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    issuer_url: Mapped[str] = mapped_column(String(500))  # e.g. https://auth.example.com/application/o/certdax
    scopes: Mapped[str] = mapped_column(String(500), default="openid profile email")
    # Auto-provisioning
    auto_create_users: Mapped[bool] = mapped_column(Boolean, default=True)
    default_group_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    admin_group: Mapped[str | None] = mapped_column(String(255), nullable=True)  # IdP group name that grants admin
    group_claim: Mapped[str] = mapped_column(String(100), default="groups")  # JWT claim for groups
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
