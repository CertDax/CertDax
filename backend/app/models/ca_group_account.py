from __future__ import annotations

from sqlalchemy import ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class CaGroupAccount(Base):
    """Per-group ACME account override for global Certificate Authorities.

    When a CA has group_id=NULL (global), each group gets its own ACME
    registration (email, account key, account URL) stored here.
    """

    __tablename__ = "ca_group_accounts"
    __table_args__ = (UniqueConstraint("ca_id", "group_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    ca_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("certificate_authorities.id", ondelete="CASCADE"), nullable=False
    )
    group_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("groups.id", ondelete="CASCADE"), nullable=False
    )
    contact_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    account_key_pem: Mapped[str | None] = mapped_column(Text, nullable=True)
    account_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
