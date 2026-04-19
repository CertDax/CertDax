"""Kubernetes operator-facing API endpoints.

The operator sends heartbeats here so the dashboard can show live status.
Authentication: Bearer token (same pattern as deploy agents).
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.k8s_operator import K8sOperator
from app.models.k8s_deployment import K8sDeployment
from app.utils.crypto import hash_token
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

router = APIRouter()
security = HTTPBearer()


class K8sHeartbeat(BaseModel):
    namespace: str | None = None
    deployment_name: str | None = None
    cluster_name: str | None = None
    operator_version: str | None = None
    kubernetes_version: str | None = None
    pod_name: str | None = None
    node_name: str | None = None
    cpu_usage: str | None = None
    memory_usage: str | None = None
    memory_limit: str | None = None
    managed_certificates: int = 0
    ready_certificates: int = 0
    pending_certificates: int = 0
    failed_certificates: int = 0
    last_error: str | None = None
    recent_logs: list[str] | None = None
    certificates: list[dict] | None = None


def get_k8s_operator(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
) -> K8sOperator:
    token_hash = hash_token(credentials.credentials)
    operator = (
        db.query(K8sOperator)
        .filter(K8sOperator.operator_token_hash == token_hash)
        .first()
    )
    if operator is None:
        raise HTTPException(status_code=401, detail="Invalid operator token")
    return operator


@router.post("/heartbeat", summary="K8s operator heartbeat")
def heartbeat(
    data: K8sHeartbeat,
    request: Request,
    db: Session = Depends(get_db),
    operator: K8sOperator = Depends(get_k8s_operator),
):
    operator.namespace = data.namespace
    operator.deployment_name = data.deployment_name
    operator.cluster_name = data.cluster_name
    operator.operator_version = data.operator_version
    operator.kubernetes_version = data.kubernetes_version
    operator.pod_name = data.pod_name
    operator.node_name = data.node_name
    if data.cpu_usage:
        operator.cpu_usage = data.cpu_usage
    operator.memory_usage = data.memory_usage
    operator.memory_limit = data.memory_limit
    operator.managed_certificates = data.managed_certificates
    operator.ready_certificates = data.ready_certificates
    operator.pending_certificates = data.pending_certificates
    operator.failed_certificates = data.failed_certificates
    operator.last_error = data.last_error
    if data.recent_logs is not None:
        import json
        operator.recent_logs = json.dumps(data.recent_logs[-200:])
    import json as _json
    certs = data.certificates if data.certificates is not None else []
    operator.managed_certs_json = _json.dumps(certs)

    # Auto-clear completed CR deletions: if a pending deletion's cert ID
    # is no longer reported in managed certs, it was processed.
    if operator.pending_cr_deletions:
        import json as _json2
        pending = _json2.loads(operator.pending_cr_deletions)
        if pending and data.certificates is not None:
            reported_ids = {(c.get("certificate_id"), c.get("type")) for c in data.certificates}
            remaining = [p for p in pending if (p["certificate_id"], p["certificate_type"]) in reported_ids]
            operator.pending_cr_deletions = _json2.dumps(remaining) if remaining else None
    operator.status = "online"
    operator.last_seen = datetime.now(timezone.utc)
    db.commit()

    # Return desired certificate deployments so the operator can reconcile CRs
    deployments = (
        db.query(K8sDeployment)
        .filter(K8sDeployment.operator_id == operator.id)
        .all()
    )
    desired = [
        {
            "id": d.id,
            "certificate_id": d.certificate_id,
            "type": d.certificate_type,
            "secret_name": d.secret_name,
            "namespace": d.namespace,
            "sync_interval": d.sync_interval,
            "include_ca": d.include_ca,
        }
        for d in deployments
    ]

    # Include pending CR deletions (remap to match Go struct: certificate_id + type)
    # Filter out any pending deletions that conflict with active deployments
    # to prevent create/delete loops.
    import json as _json3
    raw_pending = _json3.loads(operator.pending_cr_deletions) if operator.pending_cr_deletions else []
    desired_keys = {(d.certificate_id, d.certificate_type) for d in deployments}
    filtered_pending = [p for p in raw_pending if (p["certificate_id"], p["certificate_type"]) not in desired_keys]
    if len(filtered_pending) != len(raw_pending):
        operator.pending_cr_deletions = _json3.dumps(filtered_pending) if filtered_pending else None
        db.commit()
    delete_certs = [
        {"certificate_id": p["certificate_id"], "type": p["certificate_type"]}
        for p in filtered_pending
    ]
    return {"status": "ok", "desired_certificates": desired, "delete_certificates": delete_certs}
