from datetime import datetime, timezone
from pydantic import BaseModel, field_validator


class DeploymentTargetCreate(BaseModel):
    name: str
    hostname: str
    os_type: str = "linux"  # linux or windows
    deploy_path: str = "/etc/ssl/certs"
    reload_command: str | None = None
    pre_deploy_script: str | None = None
    post_deploy_script: str | None = None


class DeploymentTargetUpdate(BaseModel):
    name: str | None = None
    hostname: str | None = None
    deploy_path: str | None = None
    reload_command: str | None = None
    pre_deploy_script: str | None = None
    post_deploy_script: str | None = None


class DeploymentTargetResponse(BaseModel):
    id: int
    name: str
    hostname: str
    deploy_path: str
    reload_command: str | None = None
    pre_deploy_script: str | None = None
    post_deploy_script: str | None = None
    os_type: str = "linux"
    status: str
    last_seen: datetime | None = None
    agent_os: str | None = None
    agent_arch: str | None = None
    agent_version: str | None = None
    agent_ip: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}

    @field_validator("last_seen", "created_at", mode="before")
    @classmethod
    def ensure_utc(cls, v: datetime | None) -> datetime | None:
        if v is not None and isinstance(v, datetime) and v.tzinfo is None:
            return v.replace(tzinfo=timezone.utc)
        return v


class DeploymentTargetCreateResponse(DeploymentTargetResponse):
    agent_token: str


class AgentCertificateResponse(BaseModel):
    id: int
    certificate_id: int | None = None
    self_signed_certificate_id: int | None = None
    certificate_name: str | None = None
    certificate_status: str | None = None
    certificate_type: str = "acme"
    expires_at: datetime | None = None
    auto_deploy: bool = True
    deploy_format: str = "crt"
    created_at: datetime

    model_config = {"from_attributes": True}


class AgentGroupRef(BaseModel):
    id: int
    name: str


class AgentDetailResponse(DeploymentTargetResponse):
    assigned_certificates: list[AgentCertificateResponse] = []
    agent_groups: list[AgentGroupRef] = []
    deployment_count: int = 0
    deployed_count: int = 0
    failed_count: int = 0


class AgentCertificateAssign(BaseModel):
    certificate_id: int | None = None
    self_signed_certificate_id: int | None = None
    auto_deploy: bool = True
    deploy_format: str = "crt"


class CertificateDeploymentCreate(BaseModel):
    certificate_id: int
    target_id: int
    deploy_format: str = "crt"


class CertificateDeploymentResponse(BaseModel):
    id: int
    certificate_id: int | None = None
    self_signed_certificate_id: int | None = None
    target_id: int
    target_name: str | None = None
    certificate_name: str | None = None
    certificate_type: str = "acme"
    status: str
    deploy_format: str = "crt"
    deployed_at: datetime | None = None
    error_message: str | None = None
    created_at: datetime
    file_paths: list[str] = []

    model_config = {"from_attributes": True}

    @field_validator("deployed_at", "created_at", mode="before")
    @classmethod
    def ensure_utc(cls, v: datetime | None) -> datetime | None:
        if v is not None and isinstance(v, datetime) and v.tzinfo is None:
            return v.replace(tzinfo=timezone.utc)
        return v


class AgentHeartbeat(BaseModel):
    hostname: str
    os: str | None = None
    arch: str | None = None
    version: str | None = None


class AgentDeploymentStatus(BaseModel):
    status: str
    error_message: str | None = None
