from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.api.deps import get_agent_target
from app.database import get_db
from app.models.certificate import Certificate
from app.models.deployment import CertificateDeployment, DeploymentTarget
from app.models.selfsigned import SelfSignedCertificate
from app.schemas.deployment import (
    AgentDeploymentStatus,
    AgentHeartbeat,
    CertificateDeploymentResponse,
)
from app.utils.crypto import decrypt
import base64

router = APIRouter()


@router.post("/heartbeat")
def agent_heartbeat(
    req: AgentHeartbeat,
    request: Request,
    target: DeploymentTarget = Depends(get_agent_target),
    db: Session = Depends(get_db),
):
    target.status = "online"
    target.last_seen = datetime.now(timezone.utc)
    if req.os:
        target.agent_os = req.os
    if req.arch:
        target.agent_arch = req.arch
    if req.version:
        target.agent_version = req.version
    # Store the client IP
    client_ip = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    if not client_ip and request.client:
        client_ip = request.client.host
    if client_ip:
        target.agent_ip = client_ip
    db.commit()
    return {"status": "ok"}


@router.get("/poll", response_model=list[CertificateDeploymentResponse])
def agent_poll(
    target: DeploymentTarget = Depends(get_agent_target),
    db: Session = Depends(get_db),
):
    target.status = "online"
    target.last_seen = datetime.now(timezone.utc)
    db.commit()

    deployments = (
        db.query(CertificateDeployment)
        .filter(
            CertificateDeployment.target_id == target.id,
            CertificateDeployment.status.in_(["pending", "pending_removal"]),
        )
        .all()
    )
    result = []
    for dep in deployments:
        resp = CertificateDeploymentResponse.model_validate(dep)
        resp.target_name = target.name
        if dep.certificate:
            resp.certificate_name = dep.certificate.common_name
            resp.certificate_type = "acme"
        elif dep.self_signed_certificate:
            resp.certificate_name = dep.self_signed_certificate.common_name
            resp.certificate_type = "self-signed"
        elif dep.common_name:
            resp.certificate_name = dep.common_name
        result.append(resp)
    return result


@router.get("/certificate/{deployment_id}")
def agent_get_certificate(
    deployment_id: int,
    target: DeploymentTarget = Depends(get_agent_target),
    db: Session = Depends(get_db),
):
    deployment = (
        db.query(CertificateDeployment)
        .filter(
            CertificateDeployment.id == deployment_id,
            CertificateDeployment.target_id == target.id,
        )
        .first()
    )
    if not deployment:
        raise HTTPException(status_code=404, detail="Deployment not found")

    deploy_format = deployment.deploy_format or "crt"

    # Handle self-signed certificate
    if deployment.self_signed_certificate_id:
        ss_cert = (
            db.query(SelfSignedCertificate)
            .filter(SelfSignedCertificate.id == deployment.self_signed_certificate_id)
            .first()
        )
        if not ss_cert or not ss_cert.certificate_pem:
            raise HTTPException(status_code=400, detail="Certificate not ready")

        private_key_pem = ""
        if ss_cert.private_key_pem_encrypted:
            private_key_pem = decrypt(ss_cert.private_key_pem_encrypted)

        result = {
            "common_name": ss_cert.common_name,
            "certificate_pem": ss_cert.certificate_pem,
            "private_key_pem": private_key_pem,
            "chain_pem": "",
            "fullchain_pem": ss_cert.certificate_pem or "",
            "deploy_path": target.deploy_path,
            "reload_command": target.reload_command,
            "pre_deploy_script": target.pre_deploy_script,
            "post_deploy_script": target.post_deploy_script,
            "deploy_format": deploy_format,
            "pfx_data": "",
            "is_ca": ss_cert.is_ca,
        }

        if deploy_format == "pfx" and private_key_pem and ss_cert.certificate_pem:
            from cryptography.hazmat.primitives.serialization import (
                load_pem_private_key,
                pkcs12,
            )
            from cryptography import x509 as cx509
            from cryptography.hazmat.primitives import serialization

            priv_key = load_pem_private_key(private_key_pem.encode(), password=None)
            cert_obj = cx509.load_pem_x509_certificate(ss_cert.certificate_pem.encode())

            pfx_bytes = pkcs12.serialize_key_and_certificates(
                name=(ss_cert.common_name or "cert").encode(),
                key=priv_key,
                cert=cert_obj,
                cas=None,
                encryption_algorithm=serialization.NoEncryption(),
            )
            result["pfx_data"] = base64.b64encode(pfx_bytes).decode()

        return result

    # Handle ACME certificate
    cert = (
        db.query(Certificate)
        .filter(Certificate.id == deployment.certificate_id)
        .first()
    )
    if not cert or not cert.certificate_pem:
        raise HTTPException(status_code=400, detail="Certificate not ready")

    private_key_pem = ""
    if cert.private_key_pem_encrypted:
        private_key_pem = decrypt(cert.private_key_pem_encrypted)

    deploy_format = deployment.deploy_format or "crt"

    result = {
        "common_name": cert.common_name,
        "certificate_pem": cert.certificate_pem,
        "private_key_pem": private_key_pem,
        "chain_pem": cert.chain_pem or "",
        "fullchain_pem": (cert.certificate_pem or "") + (cert.chain_pem or ""),
        "deploy_path": target.deploy_path,
        "reload_command": target.reload_command,
        "pre_deploy_script": target.pre_deploy_script,
        "post_deploy_script": target.post_deploy_script,
        "deploy_format": deploy_format,
        "pfx_data": "",
        "is_ca": False,
    }

    if deploy_format == "pfx" and private_key_pem and cert.certificate_pem:
        from cryptography.hazmat.primitives.serialization import (
            load_pem_private_key,
            pkcs12,
        )
        from cryptography import x509 as cx509
        from cryptography.hazmat.primitives import serialization

        priv_key = load_pem_private_key(private_key_pem.encode(), password=None)
        cert_obj = cx509.load_pem_x509_certificate(cert.certificate_pem.encode())
        cas = None
        if cert.chain_pem and cert.chain_pem.strip():
            cas = []
            for pem_block in cert.chain_pem.strip().split("-----END CERTIFICATE-----"):
                pem_block = pem_block.strip()
                if pem_block:
                    pem_block += "\n-----END CERTIFICATE-----\n"
                    cas.append(cx509.load_pem_x509_certificate(pem_block.encode()))

        pfx_bytes = pkcs12.serialize_key_and_certificates(
            name=(cert.common_name or "cert").encode(),
            key=priv_key,
            cert=cert_obj,
            cas=cas,
            encryption_algorithm=serialization.NoEncryption(),
        )
        result["pfx_data"] = base64.b64encode(pfx_bytes).decode()

    return result


@router.get("/removal/{deployment_id}")
def agent_get_removal_info(
    deployment_id: int,
    target: DeploymentTarget = Depends(get_agent_target),
    db: Session = Depends(get_db),
):
    deployment = (
        db.query(CertificateDeployment)
        .filter(
            CertificateDeployment.id == deployment_id,
            CertificateDeployment.target_id == target.id,
        )
        .first()
    )
    if not deployment:
        raise HTTPException(status_code=404, detail="Deployment not found")

    cert = None
    if deployment.certificate_id:
        cert = (
            db.query(Certificate)
            .filter(Certificate.id == deployment.certificate_id)
            .first()
        )

    ss_cert = None
    if deployment.self_signed_certificate_id:
        ss_cert = (
            db.query(SelfSignedCertificate)
            .filter(SelfSignedCertificate.id == deployment.self_signed_certificate_id)
            .first()
        )

    # Use stored common_name on deployment, fall back to certificate
    common_name = deployment.common_name or (cert.common_name if cert else None) or (ss_cert.common_name if ss_cert else "unknown")

    return {
        "common_name": common_name,
        "deploy_path": target.deploy_path,
        "reload_command": target.reload_command,
        "pre_deploy_script": target.pre_deploy_script,
        "post_deploy_script": target.post_deploy_script,
        "deploy_format": deployment.deploy_format or "crt",
    }


@router.post("/deploy/{deployment_id}/status")
def agent_report_status(
    deployment_id: int,
    req: AgentDeploymentStatus,
    target: DeploymentTarget = Depends(get_agent_target),
    db: Session = Depends(get_db),
):
    deployment = (
        db.query(CertificateDeployment)
        .filter(
            CertificateDeployment.id == deployment_id,
            CertificateDeployment.target_id == target.id,
        )
        .first()
    )
    if not deployment:
        raise HTTPException(status_code=404, detail="Deployment not found")

    if req.status == "deployed":
        deployment.status = "deployed"
        deployment.deployed_at = datetime.now(timezone.utc)
        deployment.error_message = None
    elif req.status == "failed":
        deployment.status = "failed"
        deployment.error_message = req.error_message
    elif req.status == "removed":
        db.delete(deployment)
        db.commit()
        return {"status": "ok"}

    db.commit()
    return {"status": "ok"}
