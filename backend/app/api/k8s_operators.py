"""User-facing Kubernetes operator management API.

CRUD for K8s operators (list, create, detail, delete).
Authentication: JWT or API key (same as agents).
"""

import json
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, visible_group_ids
from app.database import get_db
from app.models.api_key import ApiKey
from app.models.k8s_operator import K8sOperator
from app.models.k8s_deployment import K8sDeployment
from app.models.selfsigned import SelfSignedCertificate
from app.models.certificate import Certificate
from app.models.user import User
from app.utils.crypto import hash_token

router = APIRouter()

OFFLINE_THRESHOLD_SECONDS = 120


def _parse_logs(raw: str | None) -> list[str]:
    if not raw:
        return []
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return []


def _parse_certs(raw: str | None) -> list[dict]:
    if not raw:
        return []
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return []


def _compute_status(op: K8sOperator) -> str:
    if not op.last_seen:
        return "offline"
    delta = datetime.now(timezone.utc) - op.last_seen
    return "online" if delta < timedelta(seconds=OFFLINE_THRESHOLD_SECONDS) else "offline"


def _resolve_cert_name(db: Session, certificate_id: int, certificate_type: str) -> str | None:
    """Look up the common name for a certificate ID."""
    if certificate_type == "selfsigned":
        cert = db.query(SelfSignedCertificate).filter(SelfSignedCertificate.id == certificate_id).first()
        return cert.common_name if cert else None
    else:
        cert = db.query(Certificate).filter(Certificate.id == certificate_id).first()
        return cert.common_name if cert else None


def _operator_response(op: K8sOperator, db: Session | None = None) -> dict:
    reported = _parse_certs(op.managed_certs_json)

    # Merge pending K8sDeployment records not yet reported by the operator
    extra_pending: list[dict] = []
    extra_pending_count = 0
    if db is not None:
        reported_keys = {(c.get("certificate_id"), c.get("type")) for c in reported}
        deployments = (
            db.query(K8sDeployment)
            .filter(K8sDeployment.operator_id == op.id)
            .all()
        )
        for d in deployments:
            if (d.certificate_id, d.certificate_type) not in reported_keys:
                common_name = _resolve_cert_name(db, d.certificate_id, d.certificate_type)
                extra_pending.append({
                    "certificate_id": d.certificate_id,
                    "type": d.certificate_type,
                    "common_name": common_name or f"Certificate #{d.certificate_id}",
                    "secret_name": d.secret_name,
                    "namespace": d.namespace,
                    "ready": False,
                    "dashboard_pending": True,
                    "message": "Waiting for operator to pick up",
                    "expires_at": None,
                    "last_synced_at": None,
                    "ingresses": [],
                })
                extra_pending_count += 1

    certificates = extra_pending + reported

    return {
        "id": op.id,
        "name": op.name,
        "namespace": op.namespace,
        "deployment_name": op.deployment_name,
        "cluster_name": op.cluster_name,
        "operator_version": op.operator_version,
        "kubernetes_version": op.kubernetes_version,
        "pod_name": op.pod_name,
        "node_name": op.node_name,
        "cpu_usage": op.cpu_usage,
        "memory_usage": op.memory_usage,
        "memory_limit": op.memory_limit,
        "managed_certificates": op.managed_certificates + extra_pending_count,
        "ready_certificates": op.ready_certificates,
        "pending_certificates": op.pending_certificates + extra_pending_count,
        "failed_certificates": op.failed_certificates,
        "status": _compute_status(op),
        "last_seen": op.last_seen.isoformat() if op.last_seen else None,
        "last_error": op.last_error,
        "recent_logs": _parse_logs(op.recent_logs),
        "certificates": certificates,
        "created_at": op.created_at.isoformat() if op.created_at else None,
    }


class K8sOperatorCreate(BaseModel):
    name: str
    cluster_name: str = ""


@router.get("", summary="List K8s operators")
def list_operators(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    gids = visible_group_ids(db, user, "k8s_operators")
    operators = (
        db.query(K8sOperator)
        .filter(K8sOperator.group_id.in_(gids))
        .order_by(K8sOperator.name)
        .all()
    )
    return [_operator_response(op, db) for op in operators]


@router.post("", summary="Register a new K8s operator")
def create_operator(
    data: K8sOperatorCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    token = "k8s_" + secrets.token_hex(32)
    token_hash = hash_token(token)

    # Auto-create a dedicated API key for this operator
    raw_api_key = f"cm_{secrets.token_hex(32)}"
    api_key = ApiKey(
        user_id=user.id,
        name=f"K8s Operator: {data.name}",
        key_hash=hash_token(raw_api_key),
        key_prefix=raw_api_key[:12],
    )
    db.add(api_key)
    db.flush()

    op = K8sOperator(
        name=data.name,
        cluster_name=data.cluster_name or None,
        operator_token_hash=token_hash,
        api_key_id=api_key.id,
        group_id=user.group_id,
        created_at=datetime.now(timezone.utc),
    )
    db.add(op)
    db.commit()
    db.refresh(op)

    resp = _operator_response(op, db)
    resp["operator_token"] = token
    resp["api_key"] = raw_api_key
    return resp


@router.get("/{operator_id}", summary="Get K8s operator detail")
def get_operator(
    operator_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    gids = visible_group_ids(db, user, "k8s_operators")
    op = (
        db.query(K8sOperator)
        .filter(K8sOperator.id == operator_id, K8sOperator.group_id.in_(gids))
        .first()
    )
    if not op:
        raise HTTPException(status_code=404, detail="Operator not found")
    return _operator_response(op, db)


@router.delete("/{operator_id}", summary="Delete K8s operator")
def delete_operator(
    operator_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    gids = visible_group_ids(db, user, "k8s_operators")
    op = (
        db.query(K8sOperator)
        .filter(K8sOperator.id == operator_id, K8sOperator.group_id.in_(gids))
        .first()
    )
    if not op:
        raise HTTPException(status_code=404, detail="Operator not found")
    # Delete the linked API key
    if op.api_key_id:
        linked_key = db.query(ApiKey).filter(ApiKey.id == op.api_key_id).first()
        if linked_key:
            db.delete(linked_key)
    db.delete(op)
    db.commit()
    return {"status": "deleted"}


@router.post("/{operator_id}/regenerate-token", summary="Regenerate operator token")
def regenerate_token(
    operator_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    gids = visible_group_ids(db, user, "k8s_operators")
    op = (
        db.query(K8sOperator)
        .filter(K8sOperator.id == operator_id, K8sOperator.group_id.in_(gids))
        .first()
    )
    if not op:
        raise HTTPException(status_code=404, detail="Operator not found")

    token = "k8s_" + secrets.token_hex(32)
    op.operator_token_hash = hash_token(token)
    db.commit()
    return {"operator_token": token}


# --- K8s certificate deployments (push certs to operator) ---


class K8sDeploymentCreate(BaseModel):
    certificate_id: int
    certificate_type: str = "selfsigned"
    secret_name: str
    namespace: str = "default"
    sync_interval: str = "1h"
    include_ca: bool = True


def _deployment_response(d: K8sDeployment) -> dict:
    return {
        "id": d.id,
        "operator_id": d.operator_id,
        "certificate_id": d.certificate_id,
        "certificate_type": d.certificate_type,
        "secret_name": d.secret_name,
        "namespace": d.namespace,
        "sync_interval": d.sync_interval,
        "include_ca": d.include_ca,
        "created_at": d.created_at.isoformat() if d.created_at else None,
    }


@router.get("/{operator_id}/deployments", summary="List certificate deployments for operator")
def list_deployments(
    operator_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    gids = visible_group_ids(db, user, "k8s_operators")
    op = (
        db.query(K8sOperator)
        .filter(K8sOperator.id == operator_id, K8sOperator.group_id.in_(gids))
        .first()
    )
    if not op:
        raise HTTPException(status_code=404, detail="Operator not found")
    deployments = (
        db.query(K8sDeployment)
        .filter(K8sDeployment.operator_id == operator_id)
        .order_by(K8sDeployment.created_at)
        .all()
    )
    return [_deployment_response(d) for d in deployments]


@router.post("/{operator_id}/deployments", summary="Deploy a certificate to the K8s operator")
def create_deployment(
    operator_id: int,
    data: K8sDeploymentCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    gids = visible_group_ids(db, user, "k8s_operators")
    op = (
        db.query(K8sOperator)
        .filter(K8sOperator.id == operator_id, K8sOperator.group_id.in_(gids))
        .first()
    )
    if not op:
        raise HTTPException(status_code=404, detail="Operator not found")

    dep = K8sDeployment(
        operator_id=operator_id,
        certificate_id=data.certificate_id,
        certificate_type=data.certificate_type,
        secret_name=data.secret_name,
        namespace=data.namespace,
        sync_interval=data.sync_interval,
        include_ca=data.include_ca,
    )
    db.add(dep)
    db.commit()
    db.refresh(dep)
    return _deployment_response(dep)


@router.delete("/{operator_id}/deployments/{deployment_id}", summary="Remove a certificate deployment")
def delete_deployment(
    operator_id: int,
    deployment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    gids = visible_group_ids(db, user, "k8s_operators")
    op = (
        db.query(K8sOperator)
        .filter(K8sOperator.id == operator_id, K8sOperator.group_id.in_(gids))
        .first()
    )
    if not op:
        raise HTTPException(status_code=404, detail="Operator not found")
    dep = (
        db.query(K8sDeployment)
        .filter(K8sDeployment.id == deployment_id, K8sDeployment.operator_id == operator_id)
        .first()
    )
    if not dep:
        raise HTTPException(status_code=404, detail="Deployment not found")
    db.delete(dep)
    db.commit()
    return {"status": "deleted"}


class DeleteCRRequest(BaseModel):
    certificate_id: int
    certificate_type: str


@router.post("/{operator_id}/delete-cr", summary="Request deletion of a YAML-created certificate CR")
def request_cr_deletion(
    operator_id: int,
    data: DeleteCRRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Mark a certificate CR for deletion by the operator. Used for certs created
    via YAML (not dashboard-managed) that don't have a K8sDeployment record."""
    gids = visible_group_ids(db, user, "k8s_operators")
    op = (
        db.query(K8sOperator)
        .filter(K8sOperator.id == operator_id, K8sOperator.group_id.in_(gids))
        .first()
    )
    if not op:
        raise HTTPException(status_code=404, detail="Operator not found")

    pending = json.loads(op.pending_cr_deletions) if op.pending_cr_deletions else []
    # Avoid duplicates
    entry = {"certificate_id": data.certificate_id, "certificate_type": data.certificate_type}
    if entry not in pending:
        pending.append(entry)
    op.pending_cr_deletions = json.dumps(pending)

    # Also delete the certificate from CertDax itself
    # NOTE: intentionally removed – certificates are kept in CertDax so they
    # can be reused when the same cert is redeployed later.

    db.commit()

    return {"status": "queued"}
