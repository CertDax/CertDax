from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import PlainTextResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, resolve_user_from_raw_token, visible_group_ids

_optional_bearer = HTTPBearer(auto_error=False)
from app.config import settings
from app.database import get_db
from app.models.certificate import Certificate
from app.models.deployment import AgentCertificate, CertificateDeployment, DeploymentTarget
from app.models.agent_group import AgentGroup, AgentGroupMember
from app.models.selfsigned import SelfSignedCertificate
from app.models.user import User
from app.schemas.deployment import (
    AgentCertificateAssign,
    AgentCertificateResponse,
    AgentDetailResponse,
    DeploymentTargetCreate,
    DeploymentTargetCreateResponse,
    DeploymentTargetResponse,
    DeploymentTargetUpdate,
)
from app.utils.crypto import generate_agent_token, hash_token

router = APIRouter()

OFFLINE_THRESHOLD_SECONDS = 120


def _compute_status(target: DeploymentTarget) -> str:
    if not target.last_seen:
        return "offline"
    delta = datetime.now(timezone.utc) - target.last_seen.replace(tzinfo=timezone.utc) if target.last_seen.tzinfo is None else datetime.now(timezone.utc) - target.last_seen
    if delta < timedelta(seconds=OFFLINE_THRESHOLD_SECONDS):
        return "online"
    return "offline"


@router.get("", response_model=list[DeploymentTargetResponse])
def list_agents(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    targets = db.query(DeploymentTarget).filter(DeploymentTarget.group_id.in_(visible_group_ids(db, user, "agents"))).order_by(DeploymentTarget.name).all()
    result = []
    for t in targets:
        resp = DeploymentTargetResponse.model_validate(t)
        resp.status = _compute_status(t)
        result.append(resp)
    return result


@router.post("", response_model=DeploymentTargetCreateResponse)
def create_agent(
    req: DeploymentTargetCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    token, token_hash = generate_agent_token()

    target = DeploymentTarget(
        name=req.name,
        hostname=req.hostname,
        os_type=req.os_type,
        deploy_path=req.deploy_path,
        reload_command=req.reload_command,
        pre_deploy_script=req.pre_deploy_script,
        post_deploy_script=req.post_deploy_script,
        agent_token_hash=token_hash,
        group_id=user.group_id,
    )
    db.add(target)
    db.commit()
    db.refresh(target)

    data = {c.name: getattr(target, c.name) for c in target.__table__.columns}
    data["agent_token"] = token
    resp = DeploymentTargetCreateResponse.model_validate(data)
    resp.status = _compute_status(target)
    return resp


# Agent binary download endpoint

def _optional_current_user(
    request: Request,
    db: Session = Depends(get_db),
) -> User | None:
    """Try to resolve a logged-in user from the Authorization header (JWT / API key).
    Returns None instead of raising 401 so the endpoint can fall back to agent-token auth."""
    auth = request.headers.get("authorization", "")
    if not auth.startswith("Bearer "):
        return None
    token = auth[7:]
    try:
        from jose import JWTError, jwt as _jwt
        payload = _jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
        uid = payload.get("sub")
        if uid:
            user = db.query(User).filter(User.id == int(uid)).first()
            if user:
                return user
    except Exception:
        pass
    # Try API key
    from app.models.api_key import ApiKey
    token_hash = hash_token(token)
    api_key = db.query(ApiKey).filter(ApiKey.key_hash == token_hash).first()
    if api_key:
        return db.query(User).filter(User.id == api_key.user_id).first()
    return None


@router.get("/install/binary/{arch}")
def download_agent_binary(
    arch: str,
    request: Request,
    db: Session = Depends(get_db),
    user: User | None = Depends(_optional_current_user),
):
    import os
    from fastapi.responses import FileResponse

    valid_archs = {"amd64", "arm64", "arm", "386"}
    if arch not in valid_archs:
        raise HTTPException(status_code=400, detail=f"Invalid architecture. Use: {', '.join(valid_archs)}")

    # Authenticated via JWT / API key (logged-in user) — allow
    if not user:
        # Fallback: try agent token auth
        auth_header = request.headers.get("authorization", "")
        token = auth_header.replace("Bearer ", "") if auth_header.startswith("Bearer ") else ""
        if not token:
            raise HTTPException(status_code=401, detail="Authorization required")

        token_hash_val = hash_token(token)
        target = db.query(DeploymentTarget).filter(
            DeploymentTarget.agent_token_hash == token_hash_val
        ).first()
        if not target:
            raise HTTPException(status_code=401, detail="Invalid token")

    binary_dir = os.path.abspath(settings.AGENT_BINARIES_DIR)
    binary_path = os.path.normpath(os.path.join(binary_dir, f"certdax-agent-linux-{arch}"))
    if not binary_path.startswith(binary_dir + os.sep) and binary_path != binary_dir:
        raise HTTPException(status_code=400, detail="Invalid path")

    if not os.path.isfile(binary_path):
        raise HTTPException(status_code=404, detail=f"Binary not found for architecture: {arch}")

    return FileResponse(
        path=binary_path,
        filename=f"certdax-agent-linux-{arch}",
        media_type="application/octet-stream",
    )


@router.get("/{agent_id}", response_model=AgentDetailResponse)
def get_agent(
    agent_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    target = db.query(DeploymentTarget).filter(DeploymentTarget.id == agent_id, DeploymentTarget.group_id.in_(visible_group_ids(db, user, "agents"))).first()
    if not target:
        raise HTTPException(status_code=404, detail="Agent not found")

    resp = AgentDetailResponse.model_validate(target)
    resp.status = _compute_status(target)

    # Parse stored recent_logs JSON
    if target.recent_logs:
        try:
            import json as _json
            resp.recent_logs = _json.loads(target.recent_logs)
        except (ValueError, TypeError):
            resp.recent_logs = []

    # Only show certificates the user has access to
    cert_gids = visible_group_ids(db, user, "certificates")
    ss_gids = visible_group_ids(db, user, "self_signed")

    # Assigned certificates
    assigns = (
        db.query(AgentCertificate)
        .filter(AgentCertificate.target_id == agent_id)
        .all()
    )
    cert_responses = []
    for ac in assigns:
        # Filter: only include certs the user can see
        if ac.certificate_id and ac.certificate:
            if ac.certificate.group_id not in cert_gids:
                continue
            cr = AgentCertificateResponse.model_validate(ac)
            cr.certificate_name = ac.certificate.common_name
            cr.certificate_status = ac.certificate.status
            cr.expires_at = ac.certificate.expires_at
            cr.certificate_type = "acme"
            from sqlalchemy import desc as _desc
            _dep = db.query(CertificateDeployment).filter(
                CertificateDeployment.target_id == agent_id,
                CertificateDeployment.certificate_id == ac.certificate_id,
            ).order_by(_desc(CertificateDeployment.created_at)).first()
            cr.deployment_status = _dep.status if _dep else "pending"
        elif ac.self_signed_certificate_id and ac.self_signed_certificate:
            if ac.self_signed_certificate.group_id not in ss_gids:
                continue
            cr = AgentCertificateResponse.model_validate(ac)
            cr.certificate_name = ac.self_signed_certificate.common_name
            cr.certificate_status = "valid"
            cr.expires_at = ac.self_signed_certificate.expires_at
            cr.certificate_type = "self-signed"
            from sqlalchemy import desc as _desc
            _dep = db.query(CertificateDeployment).filter(
                CertificateDeployment.target_id == agent_id,
                CertificateDeployment.self_signed_certificate_id == ac.self_signed_certificate_id,
            ).order_by(_desc(CertificateDeployment.created_at)).first()
            cr.deployment_status = _dep.status if _dep else "pending"
        else:
            continue
        cert_responses.append(cr)
    resp.assigned_certificates = cert_responses

    # Deployment stats — only count deployments for visible certs
    visible_cert_ids = [ac.certificate_id for ac in assigns if ac.certificate_id and ac.certificate and ac.certificate.group_id in cert_gids]
    visible_ss_ids = [ac.self_signed_certificate_id for ac in assigns if ac.self_signed_certificate_id and ac.self_signed_certificate and ac.self_signed_certificate.group_id in ss_gids]

    dep_query = (
        db.query(CertificateDeployment)
        .filter(CertificateDeployment.target_id == agent_id)
    )
    if visible_cert_ids or visible_ss_ids:
        from sqlalchemy import or_
        conditions = []
        if visible_cert_ids:
            conditions.append(CertificateDeployment.certificate_id.in_(visible_cert_ids))
        if visible_ss_ids:
            conditions.append(CertificateDeployment.self_signed_certificate_id.in_(visible_ss_ids))
        dep_query = dep_query.filter(or_(*conditions))
    else:
        from sqlalchemy import false as _false
        dep_query = dep_query.filter(_false())

    resp.deployment_count = dep_query.count()
    resp.deployed_count = dep_query.filter(CertificateDeployment.status == "deployed").count()
    resp.failed_count = dep_query.filter(CertificateDeployment.status == "failed").count()

    # Pending removal — certs the agent has been told to remove but hasn't confirmed yet
    pending_removals = (
        db.query(CertificateDeployment)
        .filter(
            CertificateDeployment.target_id == agent_id,
            CertificateDeployment.status == "pending_removal",
        )
        .all()
    )
    resp.pending_removal_cert_ids = [d.certificate_id for d in pending_removals if d.certificate_id]
    resp.pending_removal_ss_ids = [d.self_signed_certificate_id for d in pending_removals if d.self_signed_certificate_id]

    # Agent group memberships — only show groups the user can see
    agent_gids = visible_group_ids(db, user, "agents")
    memberships = (
        db.query(AgentGroupMember)
        .filter(AgentGroupMember.target_id == agent_id)
        .all()
    )
    group_refs = []
    for m in memberships:
        ag = db.query(AgentGroup).filter(AgentGroup.id == m.agent_group_id).first()
        if ag and ag.group_id in agent_gids:
            group_refs.append({"id": ag.id, "name": ag.name})
    resp.agent_groups = group_refs

    return resp


@router.put("/{agent_id}", response_model=DeploymentTargetResponse)
def update_agent(
    agent_id: int,
    req: DeploymentTargetUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    target = db.query(DeploymentTarget).filter(DeploymentTarget.id == agent_id, DeploymentTarget.group_id.in_(visible_group_ids(db, user, "agents"))).first()
    if not target:
        raise HTTPException(status_code=404, detail="Agent not found")

    if req.name is not None:
        target.name = req.name
    if req.hostname is not None:
        target.hostname = req.hostname
    if req.deploy_path is not None:
        target.deploy_path = req.deploy_path
    if req.reload_command is not None:
        target.reload_command = req.reload_command
    if req.pre_deploy_script is not None:
        target.pre_deploy_script = req.pre_deploy_script
    if req.post_deploy_script is not None:
        target.post_deploy_script = req.post_deploy_script

    db.commit()
    db.refresh(target)
    return DeploymentTargetResponse.model_validate(target)


@router.delete("/{agent_id}")
def delete_agent(
    agent_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    target = db.query(DeploymentTarget).filter(DeploymentTarget.id == agent_id, DeploymentTarget.group_id.in_(visible_group_ids(db, user, "agents"))).first()
    if not target:
        raise HTTPException(status_code=404, detail="Agent not found")

    db.delete(target)
    db.commit()
    return {"detail": "Agent deleted"}


@router.post("/{agent_id}/regenerate-token")
def regenerate_agent_token(
    agent_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    target = db.query(DeploymentTarget).filter(DeploymentTarget.id == agent_id, DeploymentTarget.group_id.in_(visible_group_ids(db, user, "agents"))).first()
    if not target:
        raise HTTPException(status_code=404, detail="Agent not found")

    token, token_hash = generate_agent_token()
    target.agent_token_hash = token_hash
    db.commit()
    return {"agent_token": token}


# Certificate assignment

@router.get("/{agent_id}/certificates", response_model=list[AgentCertificateResponse])
def list_agent_certificates(
    agent_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    target = db.query(DeploymentTarget).filter(DeploymentTarget.id == agent_id, DeploymentTarget.group_id.in_(visible_group_ids(db, user, "agents"))).first()
    if not target:
        raise HTTPException(status_code=404, detail="Agent not found")

    cert_gids = visible_group_ids(db, user, "certificates")
    ss_gids = visible_group_ids(db, user, "self_signed")

    assigns = (
        db.query(AgentCertificate)
        .filter(AgentCertificate.target_id == agent_id)
        .all()
    )
    result = []
    for ac in assigns:
        if ac.certificate_id and ac.certificate:
            if ac.certificate.group_id not in cert_gids:
                continue
            cr = AgentCertificateResponse.model_validate(ac)
            cr.certificate_name = ac.certificate.common_name
            cr.certificate_status = ac.certificate.status
            cr.expires_at = ac.certificate.expires_at
            cr.certificate_type = "acme"
        elif ac.self_signed_certificate_id and ac.self_signed_certificate:
            if ac.self_signed_certificate.group_id not in ss_gids:
                continue
            cr = AgentCertificateResponse.model_validate(ac)
            cr.certificate_name = ac.self_signed_certificate.common_name
            cr.certificate_status = "valid"
            cr.expires_at = ac.self_signed_certificate.expires_at
            cr.certificate_type = "self-signed"
        else:
            continue
        result.append(cr)
    return result


@router.post("/{agent_id}/certificates", response_model=AgentCertificateResponse)
def assign_certificate(
    agent_id: int,
    req: AgentCertificateAssign,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    target = db.query(DeploymentTarget).filter(DeploymentTarget.id == agent_id, DeploymentTarget.group_id.in_(visible_group_ids(db, user, "agents"))).first()
    if not target:
        raise HTTPException(status_code=404, detail="Agent not found")

    if not req.certificate_id and not req.self_signed_certificate_id:
        raise HTTPException(status_code=400, detail="Provide certificate_id or self_signed_certificate_id")

    if req.certificate_id and req.self_signed_certificate_id:
        raise HTTPException(status_code=400, detail="Provide only one of certificate_id or self_signed_certificate_id")

    cert = None
    ss_cert = None

    if req.certificate_id:
        cert = db.query(Certificate).filter(Certificate.id == req.certificate_id).first()
        if not cert:
            raise HTTPException(status_code=400, detail="Certificate not found")

        existing = (
            db.query(AgentCertificate)
            .filter(
                AgentCertificate.target_id == agent_id,
                AgentCertificate.certificate_id == req.certificate_id,
            )
            .first()
        )
        if existing:
            raise HTTPException(status_code=400, detail="Certificate already assigned")
    else:
        ss_cert = db.query(SelfSignedCertificate).filter(SelfSignedCertificate.id == req.self_signed_certificate_id).first()
        if not ss_cert:
            raise HTTPException(status_code=400, detail="Self-signed certificate not found")

        existing = (
            db.query(AgentCertificate)
            .filter(
                AgentCertificate.target_id == agent_id,
                AgentCertificate.self_signed_certificate_id == req.self_signed_certificate_id,
            )
            .first()
        )
        if existing:
            raise HTTPException(status_code=400, detail="Certificate already assigned")

    ac = AgentCertificate(
        target_id=agent_id,
        certificate_id=req.certificate_id,
        self_signed_certificate_id=req.self_signed_certificate_id,
        auto_deploy=req.auto_deploy,
        deploy_format=req.deploy_format,
    )
    db.add(ac)
    db.commit()
    db.refresh(ac)

    # Auto-create pending deployment
    if req.auto_deploy:
        should_deploy = False
        if cert and cert.status == "valid":
            should_deploy = True
        elif ss_cert and ss_cert.certificate_pem:
            should_deploy = True

        if should_deploy:
            deployment = CertificateDeployment(
                certificate_id=req.certificate_id,
                self_signed_certificate_id=req.self_signed_certificate_id,
                target_id=agent_id,
                deploy_format=req.deploy_format,
                status="pending",
            )
            db.add(deployment)
            db.commit()

    resp = AgentCertificateResponse.model_validate(ac)
    if cert:
        resp.certificate_name = cert.common_name
        resp.certificate_status = cert.status
        resp.expires_at = cert.expires_at
        resp.certificate_type = "acme"
    elif ss_cert:
        resp.certificate_name = ss_cert.common_name
        resp.certificate_status = "valid"
        resp.expires_at = ss_cert.expires_at
        resp.certificate_type = "self-signed"
    return resp


@router.delete("/{agent_id}/certificates/{assignment_id}")
def unassign_certificate(
    agent_id: int,
    assignment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    target = db.query(DeploymentTarget).filter(DeploymentTarget.id == agent_id, DeploymentTarget.group_id.in_(visible_group_ids(db, user, "agents"))).first()
    if not target:
        raise HTTPException(status_code=404, detail="Agent not found")

    ac = (
        db.query(AgentCertificate)
        .filter(
            AgentCertificate.id == assignment_id,
            AgentCertificate.target_id == agent_id,
        )
        .first()
    )
    if not ac:
        raise HTTPException(status_code=404, detail="Assignment not found")

    # Mark any active deployments for this cert+target as pending_removal
    if ac.certificate_id:
        active_deployments = (
            db.query(CertificateDeployment)
            .filter(
                CertificateDeployment.certificate_id == ac.certificate_id,
                CertificateDeployment.target_id == agent_id,
                CertificateDeployment.status.in_(["deployed", "pending", "failed"]),
            )
            .all()
        )
        cert = db.query(Certificate).filter(Certificate.id == ac.certificate_id).first()
        cn = cert.common_name if cert else None
    else:
        active_deployments = (
            db.query(CertificateDeployment)
            .filter(
                CertificateDeployment.self_signed_certificate_id == ac.self_signed_certificate_id,
                CertificateDeployment.target_id == agent_id,
                CertificateDeployment.status.in_(["deployed", "pending", "failed"]),
            )
            .all()
        )
        ss_cert = db.query(SelfSignedCertificate).filter(SelfSignedCertificate.id == ac.self_signed_certificate_id).first()
        cn = ss_cert.common_name if ss_cert else None

    for dep in active_deployments:
        if dep.status == "deployed":
            dep.common_name = cn
            dep.status = "pending_removal"
        else:
            db.delete(dep)

    db.delete(ac)
    db.commit()
    return {"detail": "Certificate unassigned"}


# Install script endpoint

INSTALL_SCRIPT_TEMPLATE = r"""#!/bin/sh
# CertDax Agent Installer
# Generated for: {agent_name}
set -e

API_URL="{api_url}"
AGENT_TOKEN="{agent_token}"
INSTALL_DIR="/usr/local/bin"
BINARY_NAME="certdax-agent"
CONFIG_DIR="/etc/certdax"

# Detect architecture
ARCH=$(uname -m)
case "$ARCH" in
  x86_64)  GOARCH="amd64" ;;
  aarch64) GOARCH="arm64" ;;
  armv7l|armv6l) GOARCH="arm" ;;
  i686|i386) GOARCH="386" ;;
  *) echo "Unsupported architecture: $ARCH"; exit 1 ;;
esac

echo "CertDax Agent Installer"
echo "==========================="
echo "Agent:        {agent_name}"
echo "Architecture: ${{ARCH}} (${{GOARCH}})"
echo "API URL:      ${{API_URL}}"
echo ""

# Download binary
DOWNLOAD_URL="${{API_URL}}/api/agents/install/binary/${{GOARCH}}"
echo "Downloading agent binary..."
curl -fsSL -H "Authorization: Bearer ${{AGENT_TOKEN}}" -o /tmp/${{BINARY_NAME}} "${{DOWNLOAD_URL}}" || {{
  echo "Error: could not download binary. Make sure the binaries are available on the server."
  echo "Alternative: manually copy the binary to ${{INSTALL_DIR}}/${{BINARY_NAME}}"
  echo ""
  echo "Continuing with config setup..."
  SKIP_BINARY=1
}}

if [ -z "${{SKIP_BINARY}}" ]; then
  install -m 755 /tmp/${{BINARY_NAME}} "${{INSTALL_DIR}}/${{BINARY_NAME}}"
  rm -f /tmp/${{BINARY_NAME}}
  echo "Installed binary to ${{INSTALL_DIR}}/${{BINARY_NAME}}"
fi

# Create config
mkdir -p "${{CONFIG_DIR}}"
cat > "${{CONFIG_DIR}}/config.yaml" <<YAML
api_url: "${{API_URL}}"
agent_token: "${{AGENT_TOKEN}}"
poll_interval: 30
YAML
chmod 600 "${{CONFIG_DIR}}/config.yaml"
echo "Config written to ${{CONFIG_DIR}}/config.yaml"

# Create systemd service
if [ -d "/etc/systemd/system" ]; then
  cat > /etc/systemd/system/certdax-agent.service <<SERVICE
[Unit]
Description=CertDax Deploy Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${{INSTALL_DIR}}/${{BINARY_NAME}} --config ${{CONFIG_DIR}}/config.yaml
Restart=always
RestartSec=10
User=root

[Install]
WantedBy=multi-user.target
SERVICE
  systemctl daemon-reload
  systemctl enable certdax-agent
  systemctl restart certdax-agent
  echo "Systemd service installed and started"
fi

echo ""
echo "Done! Agent is running."
if [ -z "${{SKIP_BINARY}}" ]; then
  ${{INSTALL_DIR}}/${{BINARY_NAME}} --version
fi
"""


@router.get("/{agent_id}/install-script", response_class=PlainTextResponse)
def get_install_script(
    agent_id: int,
    request: Request,
    db: Session = Depends(get_db),
):
    # Authenticate via agent token (Bearer) OR user JWT
    auth_header = request.headers.get("authorization", "")
    token = auth_header.replace("Bearer ", "") if auth_header.startswith("Bearer ") else ""

    target = db.query(DeploymentTarget).filter(DeploymentTarget.id == agent_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Try agent token auth
    if token and target.agent_token_hash == hash_token(token):
        pass  # Authenticated via agent token
    else:
        # Fall back to user JWT auth
        try:
            from app.api.deps import get_current_user as _get_user
            _get_user(token, db)  # type: ignore[arg-type]
        except Exception:
            raise HTTPException(status_code=401, detail="Invalid token")

    # Generate a new token for this install
    token, token_hash = generate_agent_token()
    target.agent_token_hash = token_hash
    db.commit()

    # Determine API URL: prefer explicit config, then forwarded headers, then request
    from app.config import settings as _settings
    if _settings.API_BASE_URL:
        api_url = _settings.API_BASE_URL.rstrip("/")
    else:
        forwarded_proto = request.headers.get("x-forwarded-proto", "https")
        forwarded_host = request.headers.get("x-forwarded-host") or request.headers.get("host")
        if forwarded_host:
            api_url = f"{forwarded_proto}://{forwarded_host}"
        else:
            api_url = str(request.base_url).rstrip("/")

    script = INSTALL_SCRIPT_TEMPLATE.format(
        agent_name=target.name,
        api_url=api_url,
        agent_token=token,
    )
    return PlainTextResponse(content=script, media_type="text/plain")


# ── Windows agent endpoints ──────────────────────────────────────────────────

def _get_ca_cert_and_key(ca_id: int, db: Session):
    """Return (cert_pem, key_pem) for a self-signed CA, decrypting the private key."""
    from app.models.selfsigned import SelfSignedCertificate
    from app.utils.crypto import decrypt

    ca = db.query(SelfSignedCertificate).filter(
        SelfSignedCertificate.id == ca_id,
        SelfSignedCertificate.is_ca == True,
    ).first()
    if not ca:
        raise HTTPException(status_code=404, detail="CA not found or not a CA certificate")
    if not ca.certificate_pem or not ca.private_key_pem_encrypted:
        raise HTTPException(status_code=400, detail="CA certificate or private key not available")
    return ca.certificate_pem, decrypt(ca.private_key_pem_encrypted)


def _generate_codesign_cert(ca_cert_pem: str, ca_key_pem: str, agent_name: str) -> tuple[str, str]:
    """Generate a code-signing certificate signed by the given CA. Returns (cert_pem, key_pem)."""
    from cryptography import x509 as cx509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import ExtendedKeyUsageOID
    import datetime

    ca_cert = cx509.load_pem_x509_certificate(ca_cert_pem.encode())
    ca_key = serialization.load_pem_private_key(ca_key_pem.encode(), password=None)

    # Generate a new RSA key for the code-signing cert
    priv_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    subject = cx509.Name([
        cx509.NameAttribute(cx509.NameOID.COMMON_NAME, f"CertDax Agent - {agent_name}"),
        cx509.NameAttribute(cx509.NameOID.ORGANIZATION_NAME, "CertDax"),
    ])

    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (
        cx509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(ca_cert.subject)
        .public_key(priv_key.public_key())
        .serial_number(cx509.random_serial_number())
        .not_valid_before(now)
        .not_valid_after(now + datetime.timedelta(days=3650))
        .add_extension(
            cx509.BasicConstraints(ca=False, path_length=None), critical=True
        )
        .add_extension(
            cx509.KeyUsage(
                digital_signature=True,
                content_commitment=False,
                key_encipherment=False,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=False,
                crl_sign=False,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
        .add_extension(
            cx509.ExtendedKeyUsage([ExtendedKeyUsageOID.CODE_SIGNING]),
            critical=False,
        )
        # SubjectKeyIdentifier allows Windows to identify this cert in the chain
        .add_extension(
            cx509.SubjectKeyIdentifier.from_public_key(priv_key.public_key()),
            critical=False,
        )
        # AuthorityKeyIdentifier links this cert back to the CA — required for chain building
        .add_extension(
            cx509.AuthorityKeyIdentifier.from_issuer_public_key(ca_cert.public_key()),  # type: ignore[arg-type]
            critical=False,
        )
        .sign(ca_key, hashes.SHA256())  # type: ignore[arg-type]
    )

    cert_pem = cert.public_bytes(serialization.Encoding.PEM).decode()
    # PKCS#8 format ("BEGIN PRIVATE KEY") is more universally supported by osslsigncode
    key_pem = priv_key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()
    return cert_pem, key_pem


def _osslsign(cs_cert_pem: str, ca_cert_pem: str, cs_key_pem: str,
              in_path: str, out_path: str, tmpdir: str, description: str = "CertDax Agent") -> None:
    """
    Sign a Windows PE binary using osslsigncode.

    The full certificate chain (leaf + CA) is written into a single PEM file passed
    via -certs. This is more reliable than -certs + -ac with some osslsigncode builds.
    Raises RuntimeError with the actual error output on failure.
    """
    import os
    import subprocess

    chain_file = os.path.join(tmpdir, "_sign_chain.pem")
    key_file   = os.path.join(tmpdir, "_sign_key.pem")

    # Chain: leaf cert first, then CA cert — this is the Authenticode-expected order
    with open(chain_file, "w") as f:
        f.write(cs_cert_pem)
        f.write(ca_cert_pem)
    with open(key_file, "w") as f:
        f.write(cs_key_pem)

    result = subprocess.run(
        [
            "osslsigncode", "sign",
            "-certs", chain_file,
            "-key",   key_file,
            "-h",     "sha256",
            "-n",     description,
            "-in",    in_path,
            "-out",   out_path,
        ],
        capture_output=True,
        timeout=60,
    )
    if result.returncode != 0:
        err = (result.stderr.decode() or result.stdout.decode()).strip()[:800]
        raise RuntimeError(f"osslsigncode failed (exit {result.returncode}): {err}")


@router.get("/{agent_id}/install/windows-binary")
def download_windows_agent_binary(
    agent_id: int,
    ca_id: int,
    request: Request,
    db: Session = Depends(get_db),
    token: Optional[str] = Query(default=None),
    arch: str = Query(default="amd64", description="Windows architecture: amd64, arm64, 386"),
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_optional_bearer),
):
    """
    Download a Windows .exe agent binary signed with a code-signing certificate
    issued by the specified self-signed CA.
    """
    import os
    import tempfile
    import subprocess
    from fastapi.responses import FileResponse, Response

    raw = token or (credentials.credentials if credentials else None)
    if not raw:
        raise HTTPException(status_code=401, detail="Not authenticated")
    user = resolve_user_from_raw_token(raw, db)
    if user:
        target = db.query(DeploymentTarget).filter(
            DeploymentTarget.id == agent_id,
            DeploymentTarget.group_id.in_(visible_group_ids(db, user, "agents")),
        ).first()
    else:
        token_hash = hash_token(raw)
        target = db.query(DeploymentTarget).filter(
            DeploymentTarget.id == agent_id,
            DeploymentTarget.agent_token_hash == token_hash,
        ).first()
    if not target:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Validate and locate the pre-built Windows binary for requested arch
    _valid_arches = {"amd64", "arm64", "386"}
    if arch not in _valid_arches:
        raise HTTPException(status_code=400, detail=f"Unsupported arch '{arch}'. Must be one of: {', '.join(sorted(_valid_arches))}")
    binary_dir = os.path.abspath(settings.AGENT_BINARIES_DIR)
    windows_binary = os.path.normpath(os.path.join(binary_dir, f"certdax-agent-windows-{arch}.exe"))
    if not windows_binary.startswith(binary_dir + os.sep) and windows_binary != binary_dir:
        raise HTTPException(status_code=400, detail="Invalid path")
    if not os.path.isfile(windows_binary):
        raise HTTPException(
            status_code=404,
            detail=f"Windows agent binary for {arch} not found. Make sure the backend was built with Windows support.",
        )

    # Generate code-signing cert signed by the selected CA
    ca_cert_pem, ca_key_pem = _get_ca_cert_and_key(ca_id, db)
    cs_cert_pem, cs_key_pem = _generate_codesign_cert(ca_cert_pem, ca_key_pem, target.name)

    # Write temp files for signing
    with tempfile.TemporaryDirectory() as tmpdir:
        cs_cert_file = os.path.join(tmpdir, "codesign.crt")
        cs_key_file = os.path.join(tmpdir, "codesign.key")
        ca_cert_file = os.path.join(tmpdir, "ca.crt")
        signed_exe = os.path.join(tmpdir, "certdax-agent.exe")

        try:
            _osslsign(cs_cert_pem, ca_cert_pem, cs_key_pem,
                      windows_binary, signed_exe, tmpdir,
                      description=f"CertDax Agent - {target.name}")
        except (FileNotFoundError, RuntimeError) as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

        with open(signed_exe, "rb") as f:
            exe_bytes = f.read()

    safe_name = target.name.replace(" ", "_").replace("/", "_")
    return Response(
        content=exe_bytes,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="certdax-agent-{safe_name}.exe"'},
    )


@router.get("/{agent_id}/install/ca-cert")
def download_agent_ca_cert(
    agent_id: int,
    ca_id: int,
    db: Session = Depends(get_db),
    token: Optional[str] = Query(default=None),
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_optional_bearer),
):
    """Download the CA certificate that signed the Windows agent binary."""
    from fastapi.responses import Response

    raw = token or (credentials.credentials if credentials else None)
    if not raw:
        raise HTTPException(status_code=401, detail="Not authenticated")
    user = resolve_user_from_raw_token(raw, db)
    if user:
        target = db.query(DeploymentTarget).filter(
            DeploymentTarget.id == agent_id,
            DeploymentTarget.group_id.in_(visible_group_ids(db, user, "agents")),
        ).first()
    else:
        token_hash = hash_token(raw)
        target = db.query(DeploymentTarget).filter(
            DeploymentTarget.id == agent_id,
            DeploymentTarget.agent_token_hash == token_hash,
        ).first()
    if not target:
        raise HTTPException(status_code=404, detail="Agent not found")

    ca_cert_pem, _ = _get_ca_cert_and_key(ca_id, db)
    safe_name = target.name.replace(" ", "_").replace("/", "_")
    return Response(
        content=ca_cert_pem.encode(),
        media_type="application/x-pem-file",
        headers={"Content-Disposition": f'attachment; filename="certdax-ca-{safe_name}.crt"'},
    )


@router.get("/{agent_id}/install/windows-script", response_class=PlainTextResponse)
def get_windows_install_script(
    agent_id: int,
    ca_id: int,
    request: Request,
    db: Session = Depends(get_db),
    token: Optional[str] = Query(default=None, description="Bearer token passed as query param (for iwr | iex installs)"),
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_optional_bearer),
):
    raw = token or (credentials.credentials if credentials else None)
    if not raw:
        raise HTTPException(status_code=401, detail="Not authenticated")
    user = resolve_user_from_raw_token(raw, db)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid token")

    target = db.query(DeploymentTarget).filter(
        DeploymentTarget.id == agent_id,
        DeploymentTarget.group_id.in_(visible_group_ids(db, user, "agents")),
    ).first()
    if not target:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Determine base API URL
    from app.config import settings as _settings
    if _settings.API_BASE_URL:
        api_url = _settings.API_BASE_URL.rstrip("/")
    else:
        forwarded_proto = request.headers.get("x-forwarded-proto", "https")
        forwarded_host = request.headers.get("x-forwarded-host") or request.headers.get("host")
        if forwarded_host:
            api_url = f"{forwarded_proto}://{forwarded_host}"
        else:
            api_url = str(request.base_url).rstrip("/")

    # Generate a new token
    token, token_hash = generate_agent_token()
    target.agent_token_hash = token_hash
    db.commit()

    auth_header = f'Authorization: Bearer {token}'
    binary_base_url = f"{api_url}/api/agents/{agent_id}/install/windows-binary?ca_id={ca_id}"
    ca_cert_url = f"{api_url}/api/agents/{agent_id}/install/ca-cert?ca_id={ca_id}"

    script = f"""#Requires -RunAsAdministrator
# CertDax Windows Agent Installer
# Generated for: {target.name}
# Run this script in an elevated PowerShell session.

$ErrorActionPreference = "Stop"

$AgentName  = "{target.name}"
$ApiUrl     = "{api_url}"
$AgentToken = "{token}"
$InstallDir = "C:\\ProgramData\\CertDax"
$BinaryPath = "$InstallDir\\certdax-agent.exe"
$ConfigPath = "$InstallDir\\config.yaml"
$ServiceName = "CertDaxAgent"

Write-Host "CertDax Agent Installer" -ForegroundColor Cyan
Write-Host "=========================" -ForegroundColor Cyan
Write-Host "Agent: $AgentName"
Write-Host ""

# Detect architecture
$ProcessorArch = $env:PROCESSOR_ARCHITECTURE
# PROCESSOR_ARCHITEW6432 is set when running 32-bit PowerShell on a 64-bit OS
if ($env:PROCESSOR_ARCHITEW6432) {{ $ProcessorArch = $env:PROCESSOR_ARCHITEW6432 }}
$Arch = switch ($ProcessorArch) {{
    'AMD64' {{ 'amd64' }}
    'ARM64' {{ 'arm64' }}
    'x86'   {{ '386' }}
    default {{ throw "Unsupported processor architecture: $ProcessorArch" }}
}}
Write-Host "Detected architecture: $ProcessorArch ($Arch)" -ForegroundColor DarkGray
Write-Host ""

$BinaryUrl  = "{binary_base_url}&arch=$Arch"
$CaCertUrl  = "{ca_cert_url}"
$headers    = @{{ Authorization = "Bearer $AgentToken" }}

# Step 1 – Install CA certificate into Trusted Root + Trusted Publishers
# Adding to TrustedPublisher suppresses the SmartScreen reputation warning for this CA.
Write-Host "[1/4] Installing CA certificate into Trusted Root + Trusted Publishers..." -ForegroundColor Yellow
$caCertPath = "$env:TEMP\\certdax-ca.crt"
Invoke-WebRequest -Uri $CaCertUrl -Headers $headers -OutFile $caCertPath
Import-Certificate -FilePath $caCertPath -CertStoreLocation Cert:\\LocalMachine\\Root | Out-Null
Import-Certificate -FilePath $caCertPath -CertStoreLocation Cert:\\LocalMachine\\TrustedPublisher | Out-Null
Remove-Item $caCertPath -Force
Write-Host "   CA certificate installed." -ForegroundColor Green

# Step 2 – Stop existing service and download the signed agent binary
Write-Host "[2/4] Downloading signed agent binary..." -ForegroundColor Yellow
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$existingService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existingService) {{
    Write-Host "   Existing service found — stopping before upgrade..." -ForegroundColor Yellow
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}}
Invoke-WebRequest -Uri $BinaryUrl -Headers $headers -OutFile $BinaryPath
Write-Host "   Binary downloaded to $BinaryPath" -ForegroundColor Green

# Step 3 – Write configuration file
Write-Host "[3/4] Writing configuration..." -ForegroundColor Yellow
@"
api_url: "$ApiUrl"
agent_token: "$AgentToken"
poll_interval: 30
"@ | Set-Content -Path $ConfigPath -Encoding UTF8
Write-Host "   Config written to $ConfigPath" -ForegroundColor Green

# Step 4 – Install (or re-register) as Windows service
$existingService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existingService) {{
    Write-Host "[4/4] Re-registering Windows service (upgrade)..." -ForegroundColor Yellow
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    sc.exe delete $ServiceName | Out-Null
    Start-Sleep -Seconds 2
}} else {{
    Write-Host "[4/4] Installing Windows service..." -ForegroundColor Yellow
}}
New-Service -Name $ServiceName `
            -BinaryPathName "`"$BinaryPath`" --config `"$ConfigPath`"" `
            -DisplayName "CertDax Deploy Agent" `
            -Description "CertDax certificate deployment agent for {target.name}" `
            -StartupType Automatic | Out-Null
# Configure recovery: restart after 30 s on 1st, 2nd, and subsequent failures.
# Reset the failure count after 1 day of clean uptime.
sc.exe failure $ServiceName reset= 86400 actions= restart/30000/restart/30000/restart/30000 | Out-Null
Start-Service -Name $ServiceName
Write-Host "   Service '$ServiceName' installed and started." -ForegroundColor Green

# Write uninstall helper script
$UninstallPath = "$InstallDir\\uninstall.ps1"
@'
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {{
    Start-Process powershell -Verb RunAs -ArgumentList "-ExecutionPolicy Bypass -File `"$($MyInvocation.MyCommand.Path)`""
    exit
}}
$ServiceName = "CertDaxAgent"
$InstallDir  = "C:\\ProgramData\\CertDax"

Write-Host "Stopping CertDax Agent service..." -ForegroundColor Yellow
Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
sc.exe delete $ServiceName | Out-Null
Start-Sleep -Seconds 2

Write-Host "Removing files..." -ForegroundColor Yellow
Remove-Item -Path "$InstallDir\\certdax-agent.exe" -Force -ErrorAction SilentlyContinue
Remove-Item -Path "$InstallDir\\config.yaml"        -Force -ErrorAction SilentlyContinue
Remove-Item -Path "$InstallDir\\logs"               -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path $MyInvocation.MyCommand.Path     -Force -ErrorAction SilentlyContinue
Remove-Item -Path $InstallDir                      -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "CertDax Agent removed." -ForegroundColor Cyan
'@ | Set-Content -Path $UninstallPath -Encoding UTF8

Write-Host ""
Write-Host "Done! CertDax agent is running as a Windows service." -ForegroundColor Cyan
Write-Host ""
Write-Host "Useful commands:" -ForegroundColor DarkCyan
Write-Host "  Check status : Get-Service -Name $ServiceName"
Write-Host "  View logs    : Get-Content -Path `"$InstallDir\\logs\\certdax-agent.log`" -Tail 50"
Write-Host "  Live logs    : Get-Content -Path `"$InstallDir\\logs\\certdax-agent.log`" -Wait -Tail 20"
Write-Host "  Uninstall    : powershell -ExecutionPolicy Bypass -File `"$UninstallPath`""
"""

    return PlainTextResponse(content=script, media_type="text/plain")


# ── NSIS Windows Installer ────────────────────────────────────────────────────

_NSIS_TEMPLATE = r"""; CertDax Agent Windows Installer
; Agent: {agent_name_display}

!include "MUI2.nsh"

Name "CertDax Agent"
BrandingText "CertDax Certificate Management"
OutFile "{out_file}"
InstallDir "$PROGRAMFILES64\CertDax"
InstallDirRegKey HKLM "Software\CertDax\Agent" "InstallDir"
RequestExecutionLevel admin
Unicode True

VIProductVersion "1.0.0.0"
VIAddVersionKey "ProductName" "CertDax Agent"
VIAddVersionKey "CompanyName" "CertDax"
VIAddVersionKey "FileDescription" "CertDax Certificate Deployment Agent"
VIAddVersionKey "FileVersion" "1.0.0"
VIAddVersionKey "LegalCopyright" "CertDax"

!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Welcome to CertDax Agent Setup"
!define MUI_WELCOMEPAGE_TEXT "This wizard will install the CertDax Agent on your computer.$\r$\n$\r$\nThe agent automatically manages certificate deployments and installs certificates into the correct Windows certificate stores.$\r$\n$\r$\nClick Next to continue."
!define MUI_FINISHPAGE_TITLE "CertDax Agent Installed"
!define MUI_FINISHPAGE_TEXT "The CertDax Agent has been successfully installed and started as a Windows service.$\r$\n$\r$\nAgent: {agent_name_display}$\r$\nService: CertDaxAgent$\r$\n$\r$\nThe service is now running and will automatically connect to CertDax to manage certificate deployments."

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

Section "CertDax Agent" SecMain
    SectionIn RO

    ; ---- Install agent binary ----
    SetOutPath "$INSTDIR"
    File "certdax-agent.exe"

    ; ---- Install CA certificate into Trusted Root + Trusted Publishers ----
    ; Adding to TrustedPublisher suppresses the SmartScreen reputation warning
    ; for all executables signed by this CA on this machine.
    SetOutPath "$TEMP"
    File "ca.crt"
    DetailPrint "Installing CA certificate into Trusted Root Certification Authorities..."
    ExecWait 'certutil.exe -addstore -f "Root" "$TEMP\ca.crt"' $0
    DetailPrint "Installing CA certificate into Trusted Publishers..."
    ExecWait 'certutil.exe -addstore -f "TrustedPublisher" "$TEMP\ca.crt"' $0
    Delete "$TEMP\ca.crt"

    ; ---- Write agent configuration ----
    CreateDirectory "C:\ProgramData\CertDax"
    SetOutPath "C:\ProgramData\CertDax"
    File "config.yaml"

    ; ---- Install Windows service via PowerShell script ----
    SetOutPath "$TEMP"
    File "install-service.ps1"
    DetailPrint "Installing CertDax Agent service..."
    ExecWait 'powershell.exe -ExecutionPolicy Bypass -File "$TEMP\install-service.ps1" -InstallDir "$INSTDIR"' $0
    Delete "$TEMP\install-service.ps1"

    ; ---- Write uninstaller ----
    SetOutPath "$INSTDIR"
    WriteUninstaller "$INSTDIR\uninstall.exe"

    ; ---- Register in Add/Remove Programs ----
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\CertDaxAgent" "DisplayName" "CertDax Agent"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\CertDaxAgent" "UninstallString" '"$INSTDIR\uninstall.exe"'
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\CertDaxAgent" "QuietUninstallString" '"$INSTDIR\uninstall.exe" /S'
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\CertDaxAgent" "InstallLocation" "$INSTDIR"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\CertDaxAgent" "Publisher" "CertDax"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\CertDaxAgent" "DisplayVersion" "1.0.0"
    WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\CertDaxAgent" "NoModify" 1
    WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\CertDaxAgent" "NoRepair" 1
    WriteRegStr HKLM "Software\CertDax\Agent" "InstallDir" "$INSTDIR"
SectionEnd

Section "Uninstall"
    ; Stop and remove service
    DetailPrint "Stopping CertDax Agent service..."
    ExecWait 'sc.exe stop CertDaxAgent' $0
    ExecWait 'sc.exe delete CertDaxAgent' $0
    Sleep 2000

    ; Remove binary + uninstaller
    Delete "$INSTDIR\certdax-agent.exe"
    Delete "$INSTDIR\uninstall.exe"
    RMDir "$INSTDIR"

    ; Remove config, logs and data directory
    Delete "$PROFILE\..\ProgramData\CertDax\config.yaml"
    Delete "$PROFILE\..\ProgramData\CertDax\uninstall.ps1"
    Delete "$PROFILE\..\ProgramData\CertDax\logs\certdax-agent.log"
    Delete "$PROFILE\..\ProgramData\CertDax\logs\certdax-agent.log.1"
    RMDir "$PROFILE\..\ProgramData\CertDax\logs"
    RMDir "$PROFILE\..\ProgramData\CertDax"

    ; Remove registry entries
    DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\CertDaxAgent"
    DeleteRegKey HKLM "Software\CertDax"

    DetailPrint "CertDax Agent removed."
SectionEnd
"""


@router.get("/{agent_id}/install/windows-installer")
def download_windows_installer(
    agent_id: int,
    ca_id: int,
    request: Request,
    db: Session = Depends(get_db),
    arch: str = Query(default="amd64", description="Windows architecture: amd64, arm64, 386"),
    user: User = Depends(get_current_user),
):
    """
    Build and download a Windows NSIS installer for the CertDax agent.
    The installer embeds the signed binary, CA cert, config, and service script.
    It presents a wizard UI (Welcome → Directory → Install → Finish) and registers
    the agent as a Windows service on completion.
    """
    import os
    import re
    import tempfile
    import subprocess
    from fastapi.responses import Response

    target = db.query(DeploymentTarget).filter(
        DeploymentTarget.id == agent_id,
        DeploymentTarget.group_id.in_(visible_group_ids(db, user, "agents")),
    ).first()
    if not target:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Validate arch and locate the pre-built Windows binary
    _valid_arches = {"amd64", "arm64", "386"}
    if arch not in _valid_arches:
        raise HTTPException(status_code=400, detail=f"Unsupported arch '{arch}'. Must be one of: {', '.join(sorted(_valid_arches))}")
    binary_dir = os.path.abspath(settings.AGENT_BINARIES_DIR)
    windows_binary = os.path.normpath(os.path.join(binary_dir, f"certdax-agent-windows-{arch}.exe"))
    if not windows_binary.startswith(binary_dir + os.sep) and windows_binary != binary_dir:
        raise HTTPException(status_code=400, detail="Invalid path")
    if not os.path.isfile(windows_binary):
        raise HTTPException(
            status_code=404,
            detail=f"Windows agent binary for {arch} not found. Make sure the backend was built with Windows support.",
        )

    # Code-sign the binary using the chosen CA
    ca_cert_pem, ca_key_pem = _get_ca_cert_and_key(ca_id, db)
    cs_cert_pem, cs_key_pem = _generate_codesign_cert(ca_cert_pem, ca_key_pem, target.name)

    # Determine API URL
    if settings.API_BASE_URL:
        api_url = settings.API_BASE_URL.rstrip("/")
    else:
        forwarded_proto = request.headers.get("x-forwarded-proto", "https")
        forwarded_host = request.headers.get("x-forwarded-host") or request.headers.get("host")
        if forwarded_host:
            api_url = f"{forwarded_proto}://{forwarded_host}"
        else:
            api_url = str(request.base_url).rstrip("/")

    # Generate a fresh agent token (token rotated on each installer download)
    token, token_hash = generate_agent_token()
    target.agent_token_hash = token_hash
    db.commit()

    with tempfile.TemporaryDirectory() as tmpdir:
        agent_exe    = os.path.join(tmpdir, "certdax-agent.exe")
        ca_crt       = os.path.join(tmpdir, "ca.crt")
        config_yaml  = os.path.join(tmpdir, "config.yaml")
        svc_ps1      = os.path.join(tmpdir, "install-service.ps1")
        nsi_script   = os.path.join(tmpdir, "installer.nsi")
        installer_exe = os.path.join(tmpdir, "certdax-agent-installer.exe")

        # --- Sign the agent binary ---
        try:
            _osslsign(cs_cert_pem, ca_cert_pem, cs_key_pem,
                      windows_binary, agent_exe, tmpdir,
                      description=f"CertDax Agent - {target.name}")
        except (FileNotFoundError, RuntimeError) as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

        # --- Write CA cert (bundled into installer) ---
        with open(ca_crt, "w") as f:
            f.write(ca_cert_pem)

        # --- Write config.yaml (bundled into installer) ---
        with open(config_yaml, "w") as f:
            f.write(f'api_url: "{api_url}"\n')
            f.write(f'agent_token: "{token}"\n')
            f.write("poll_interval: 30\n")

        # --- Write service installer PS1 (bundled into installer) ---
        # PowerShell variables ($InstallDir etc.) are safe inside Python f-strings
        safe_desc = target.name.replace("'", "").replace('"', "")[:80]
        with open(svc_ps1, "w") as f:
            f.write(f"""\
param([string]$InstallDir)
$ConfigPath  = 'C:\\ProgramData\\CertDax\\config.yaml'
$ServiceName = 'CertDaxAgent'
$BinaryPath  = "$InstallDir\\certdax-agent.exe"

$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {{
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    sc.exe delete $ServiceName | Out-Null
    Start-Sleep -Seconds 2
}}

$binPathArg = "`"$BinaryPath`" --config `"$ConfigPath`""
New-Service -Name $ServiceName `
            -BinaryPathName $binPathArg `
            -DisplayName 'CertDax Deploy Agent' `
            -Description 'CertDax certificate deployment agent for {safe_desc}' `
            -StartupType Automatic
Start-Service -Name $ServiceName
Write-Host "Service $ServiceName installed and started." -ForegroundColor Green
""")

        # --- Write NSIS script ---
        safe_display = re.sub(r"[^\w\s\-]", "", target.name)[:64].strip() or "CertDax Agent"
        nsis_content = _NSIS_TEMPLATE.format(
            out_file=installer_exe,
            agent_name_display=safe_display,
        )
        with open(nsi_script, "w") as f:
            f.write(nsis_content)

        # --- Run makensis ---
        try:
            result = subprocess.run(
                ["makensis", nsi_script],
                capture_output=True,
                cwd=tmpdir,
                timeout=180,
            )
            if result.returncode != 0:
                err = (result.stderr.decode() or result.stdout.decode())[:600]
                raise HTTPException(
                    status_code=503,
                    detail=f"NSIS installer build failed: {err}",
                )
        except FileNotFoundError:
            raise HTTPException(
                status_code=503,
                detail="NSIS (makensis) is not installed on the server. Rebuild the Docker image.",
            )

        # --- Sign the NSIS installer itself so Windows shows the publisher name ---
        signed_installer = os.path.join(tmpdir, "certdax-agent-installer-signed.exe")
        try:
            _osslsign(cs_cert_pem, ca_cert_pem, cs_key_pem,
                      installer_exe, signed_installer, tmpdir,
                      description=f"CertDax Agent - {target.name} Setup")
        except (FileNotFoundError, RuntimeError) as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

        with open(signed_installer, "rb") as f:
            installer_bytes = f.read()

    safe_filename = re.sub(r"[^\w\-]", "_", target.name)
    return Response(
        content=installer_bytes,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": (
                f'attachment; filename="certdax-agent-{safe_filename}-setup.exe"'
            )
        },
    )

