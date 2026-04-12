from datetime import datetime, timezone
from pydantic import BaseModel, field_validator


class OidEntry(BaseModel):
    oid: str
    value: str


class CertificateRequest(BaseModel):
    domains: list[str]
    ca_id: int
    dns_provider_id: int | None = None
    challenge_type: str = "dns-01"
    auto_renew: bool = True
    custom_oids: list[OidEntry] | None = None
    target_id: int | None = None
    deploy_format: str = "crt"


class CertificateResponse(BaseModel):
    id: int
    common_name: str
    san_domains: str | None = None
    ca_id: int
    ca_name: str | None = None
    dns_provider_id: int | None = None
    challenge_type: str
    status: str
    issued_at: datetime | None = None
    expires_at: datetime | None = None
    auto_renew: bool
    custom_oids: str | None = None
    error_message: str | None = None
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


class CertificateDetailResponse(CertificateResponse):
    certificate_pem: str | None = None
    chain_pem: str | None = None


class CertificateStatsResponse(BaseModel):
    total: int
    active: int
    expiring_soon: int
    expired: int
    pending: int
    error: int


class DryRunStep(BaseModel):
    step: int
    title: str
    description: str
    status: str  # "ok", "warning", "error"


class DryRunResponse(BaseModel):
    success: bool
    steps: list[DryRunStep]
