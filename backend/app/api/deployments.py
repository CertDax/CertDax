from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, visible_group_ids
from app.database import get_db
from app.models.certificate import Certificate
from app.models.deployment import CertificateDeployment, DeploymentTarget
from app.models.user import User
from app.schemas.deployment import (
    CertificateDeploymentCreate,
    CertificateDeploymentResponse,
    DeploymentTargetCreate,
    DeploymentTargetCreateResponse,
    DeploymentTargetResponse,
    DeploymentTargetUpdate,
)
from app.utils.crypto import generate_agent_token

router = APIRouter()


def _safe_name(common_name: str) -> str:
    """Match Go agent's safeName function."""
    name = common_name.replace("*", "wildcard")
    name = name.replace("/", "_")
    name = name.replace(" ", "_")
    return name


def _compute_file_paths(deploy_path: str, common_name: str, deploy_format: str) -> list[str]:
    """Compute expected file paths matching Go agent's deploy logic."""
    name = _safe_name(common_name)
    fmt = deploy_format or "crt"
    if fmt == "crt":
        return [
            f"{deploy_path}/{name}.crt",
            f"{deploy_path}/{name}.key",
            f"{deploy_path}/{name}.fullchain.crt",
            f"{deploy_path}/{name}.chain.crt",
        ]
    elif fmt == "pem":
        return [f"{deploy_path}/{name}.pem"]
    elif fmt == "pfx":
        return [f"{deploy_path}/{name}.pfx"]
    return []


# Deployment Targets

@router.get("/targets", response_model=list[DeploymentTargetResponse])
def list_targets(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    targets = db.query(DeploymentTarget).filter(DeploymentTarget.group_id.in_(visible_group_ids(db, user, "agents"))).order_by(DeploymentTarget.name).all()
    return [DeploymentTargetResponse.model_validate(t) for t in targets]


@router.post("/targets", response_model=DeploymentTargetCreateResponse)
def create_target(
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
        agent_token_hash=token_hash,
        group_id=user.group_id,
    )
    db.add(target)
    db.commit()
    db.refresh(target)

    resp = DeploymentTargetCreateResponse.model_validate(target)
    resp.agent_token = token
    return resp


@router.put("/targets/{target_id}", response_model=DeploymentTargetResponse)
def update_target(
    target_id: int,
    req: DeploymentTargetUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    target = (
        db.query(DeploymentTarget)
        .filter(DeploymentTarget.id == target_id, DeploymentTarget.group_id.in_(visible_group_ids(db, user, "agents")))
        .first()
    )
    if not target:
        raise HTTPException(status_code=404, detail="Target not found")

    if req.name is not None:
        target.name = req.name
    if req.hostname is not None:
        target.hostname = req.hostname
    if req.deploy_path is not None:
        target.deploy_path = req.deploy_path
    if req.reload_command is not None:
        target.reload_command = req.reload_command

    db.commit()
    db.refresh(target)
    return DeploymentTargetResponse.model_validate(target)


@router.delete("/targets/{target_id}")
def delete_target(
    target_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    target = (
        db.query(DeploymentTarget)
        .filter(DeploymentTarget.id == target_id, DeploymentTarget.group_id.in_(visible_group_ids(db, user, "agents")))
        .first()
    )
    if not target:
        raise HTTPException(status_code=404, detail="Target not found")

    db.delete(target)
    db.commit()
    return {"detail": "Target deleted"}


# Certificate Deployments

@router.get("", response_model=list[CertificateDeploymentResponse])
def list_deployments(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    deployments = (
        db.query(CertificateDeployment)
        .join(DeploymentTarget, CertificateDeployment.target_id == DeploymentTarget.id)
        .filter(DeploymentTarget.group_id.in_(visible_group_ids(db, user, "agents")))
        .order_by(CertificateDeployment.created_at.desc())
        .all()
    )
    result = []
    for dep in deployments:
        resp = CertificateDeploymentResponse.model_validate(dep)
        if dep.target:
            resp.target_name = dep.target.name
        common_name = None
        if dep.certificate:
            resp.certificate_name = dep.certificate.common_name
            resp.certificate_type = "acme"
            common_name = dep.certificate.common_name
        elif dep.self_signed_certificate:
            resp.certificate_name = dep.self_signed_certificate.common_name
            resp.certificate_type = "self-signed"
            common_name = dep.self_signed_certificate.common_name
        elif dep.common_name:
            common_name = dep.common_name
        if common_name and dep.target:
            resp.file_paths = _compute_file_paths(
                dep.target.deploy_path, common_name, dep.deploy_format
            )
        result.append(resp)
    return result


@router.post("", response_model=CertificateDeploymentResponse)
def create_deployment(
    req: CertificateDeploymentCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    cert = db.query(Certificate).filter(Certificate.id == req.certificate_id).first()
    if not cert:
        raise HTTPException(status_code=400, detail="Certificate not found")
    if cert.status != "valid":
        raise HTTPException(status_code=400, detail="Certificate is not valid")

    target = (
        db.query(DeploymentTarget)
        .filter(DeploymentTarget.id == req.target_id)
        .first()
    )
    if not target:
        raise HTTPException(status_code=400, detail="Target not found")

    deployment = CertificateDeployment(
        certificate_id=req.certificate_id,
        target_id=req.target_id,
        deploy_format=req.deploy_format,
        status="pending",
    )
    db.add(deployment)
    db.commit()
    db.refresh(deployment)

    resp = CertificateDeploymentResponse.model_validate(deployment)
    resp.target_name = target.name
    resp.certificate_name = cert.common_name
    resp.file_paths = _compute_file_paths(
        target.deploy_path, cert.common_name, req.deploy_format
    )
    return resp


@router.delete("/{deployment_id}")
def delete_deployment(
    deployment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    deployment = (
        db.query(CertificateDeployment)
        .filter(CertificateDeployment.id == deployment_id)
        .first()
    )
    if not deployment:
        raise HTTPException(status_code=404, detail="Deployment not found")

    if deployment.status in ("deployed", "failed"):
        cert = db.query(Certificate).filter(Certificate.id == deployment.certificate_id).first()
        deployment.common_name = cert.common_name if cert else None
        deployment.status = "pending_removal"
        db.commit()
    else:
        db.delete(deployment)
        db.commit()
    return {"detail": "Deployment deleted"}
