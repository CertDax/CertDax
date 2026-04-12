from datetime import datetime, timezone
from pydantic import BaseModel, field_validator


class AgentGroupCreate(BaseModel):
    name: str
    description: str | None = None


class AgentGroupUpdate(BaseModel):
    name: str | None = None
    description: str | None = None


class AgentGroupMemberInfo(BaseModel):
    id: int
    target_id: int
    target_name: str | None = None
    target_hostname: str | None = None
    target_status: str = "offline"
    created_at: datetime

    model_config = {"from_attributes": True}

    @field_validator("created_at", mode="before")
    @classmethod
    def ensure_utc(cls, v: datetime | None) -> datetime | None:
        if v is not None and isinstance(v, datetime) and v.tzinfo is None:
            return v.replace(tzinfo=timezone.utc)
        return v


class AgentGroupResponse(BaseModel):
    id: int
    name: str
    description: str | None = None
    member_count: int = 0
    created_at: datetime

    model_config = {"from_attributes": True}

    @field_validator("created_at", mode="before")
    @classmethod
    def ensure_utc(cls, v: datetime | None) -> datetime | None:
        if v is not None and isinstance(v, datetime) and v.tzinfo is None:
            return v.replace(tzinfo=timezone.utc)
        return v


class AgentGroupDetailResponse(AgentGroupResponse):
    members: list[AgentGroupMemberInfo] = []
    assigned_certificate_ids: list[int] = []
    assigned_self_signed_ids: list[int] = []


class AgentGroupAssignCertificate(BaseModel):
    certificate_id: int | None = None
    self_signed_certificate_id: int | None = None
    auto_deploy: bool = True
    deploy_format: str = "crt"
