from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, visible_group_ids
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
    binary_path = os.path.join(binary_dir, f"certdax-agent-linux-{arch}")

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
        dep_query = dep_query.filter(False)

    resp.deployment_count = dep_query.count()
    resp.deployed_count = dep_query.filter(CertificateDeployment.status == "deployed").count()
    resp.failed_count = dep_query.filter(CertificateDeployment.status == "failed").count()

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
            _get_user(token, db)
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
        api_url = str(request.base_url).rstrip("/")
        forwarded_proto = request.headers.get("x-forwarded-proto")
        forwarded_host = request.headers.get("x-forwarded-host")
        if forwarded_host:
            proto = forwarded_proto or "https"
            api_url = f"{proto}://{forwarded_host}"

    script = INSTALL_SCRIPT_TEMPLATE.format(
        agent_name=target.name,
        api_url=api_url,
        agent_token=token,
    )
    return PlainTextResponse(content=script, media_type="text/plain")
