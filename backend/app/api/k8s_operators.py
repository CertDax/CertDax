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


def _operator_response(op: K8sOperator) -> dict:
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
        "managed_certificates": op.managed_certificates,
        "ready_certificates": op.ready_certificates,
        "failed_certificates": op.failed_certificates,
        "status": _compute_status(op),
        "last_seen": op.last_seen.isoformat() if op.last_seen else None,
        "last_error": op.last_error,
        "recent_logs": _parse_logs(op.recent_logs),
        "certificates": _parse_certs(op.managed_certs_json),
        "created_at": op.created_at.isoformat() if op.created_at else None,
    }


class K8sOperatorCreate(BaseModel):
    name: str


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
    return [_operator_response(op) for op in operators]


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
        operator_token_hash=token_hash,
        api_key_id=api_key.id,
        group_id=user.group_id,
        created_at=datetime.now(timezone.utc),
    )
    db.add(op)
    db.commit()
    db.refresh(op)

    resp = _operator_response(op)
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
    return _operator_response(op)


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
