from datetime import datetime, timezone
from pydantic import BaseModel, field_validator

from app.schemas.certificate import OidEntry


class SelfSignedRequest(BaseModel):
    common_name: str
    san_domains: list[str] | None = None
    organization: str | None = None
    organizational_unit: str | None = None
    country: str | None = None
    state: str | None = None
    locality: str | None = None
    key_type: str = "rsa"  # rsa or ec
    key_size: int = 4096  # RSA: 2048/4096, EC: 256/384
    validity_days: int = 365
    is_ca: bool = False
    ca_id: int | None = None
    auto_renew: bool = False
    renewal_threshold_days: int | None = None
    custom_oids: list[OidEntry] | None = None


class SelfSignedResponse(BaseModel):
    id: int
    common_name: str
    san_domains: str | None = None
    organization: str | None = None
    organizational_unit: str | None = None
    country: str | None = None
    state: str | None = None
    locality: str | None = None
    key_type: str
    key_size: int
    validity_days: int
    is_ca: bool
    signed_by_ca_id: int | None = None
    signed_by_ca_name: str | None = None
    auto_renew: bool
    renewal_threshold_days: int | None = None
    custom_oids: str | None = None
    issued_at: datetime | None = None
    expires_at: datetime | None = None
    created_by_username: str | None = None
    modified_by_username: str | None = None
    created_at: datetime
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}

    @field_validator("issued_at", "expires_at", "created_at", "updated_at", mode="before")
    @classmethod
    def ensure_utc(cls, v: datetime | None) -> datetime | None:
        if v is not None and isinstance(v, datetime) and v.tzinfo is None:
            return v.replace(tzinfo=timezone.utc)
        return v


class SelfSignedDetailResponse(SelfSignedResponse):
    certificate_pem: str | None = None
