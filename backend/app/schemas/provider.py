from datetime import datetime
from pydantic import BaseModel


class CertificateAuthorityCreate(BaseModel):
    name: str
    directory_url: str
    is_staging: bool = False
    contact_email: str | None = None
    eab_kid: str | None = None
    eab_hmac_key: str | None = None


class CertificateAuthorityResponse(BaseModel):
    id: int
    name: str
    directory_url: str
    is_staging: bool
    contact_email: str | None = None
    has_account: bool = False
    has_eab: bool = False
    is_global: bool = False
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class DnsProviderCreate(BaseModel):
    name: str
    provider_type: str
    credentials: dict = {}


class DnsProviderUpdate(BaseModel):
    name: str | None = None
    credentials: dict | None = None
    is_active: bool | None = None


class DnsProviderResponse(BaseModel):
    id: int
    name: str
    provider_type: str
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}
