import secrets

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.database import get_db
from app.models.api_key import ApiKey
from app.models.user import User
from app.utils.crypto import hash_token

router = APIRouter()


class ApiKeyCreateRequest(BaseModel):
    name: str


class ApiKeyResponse(BaseModel):
    id: int
    name: str
    key_prefix: str
    last_used_at: str | None
    created_at: str

    model_config = {"from_attributes": True}


class ApiKeyCreatedResponse(ApiKeyResponse):
    """Returned only once on creation — includes the full plaintext key."""
    key: str


@router.get("", response_model=list[ApiKeyResponse])
def list_api_keys(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    keys = (
        db.query(ApiKey)
        .filter(ApiKey.user_id == user.id)
        .order_by(ApiKey.created_at.desc())
        .all()
    )
    return [
        ApiKeyResponse(
            id=k.id,
            name=k.name,
            key_prefix=k.key_prefix,
            last_used_at=k.last_used_at.isoformat() if k.last_used_at else None,
            created_at=k.created_at.isoformat(),
        )
        for k in keys
    ]


@router.post("", response_model=ApiKeyCreatedResponse, status_code=201)
def create_api_key(
    req: ApiKeyCreateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not req.name or not req.name.strip():
        raise HTTPException(status_code=400, detail="Name is required")

    # Limit keys per user
    count = db.query(ApiKey).filter(ApiKey.user_id == user.id).count()
    if count >= 25:
        raise HTTPException(status_code=400, detail="Maximum of 25 API keys reached")

    raw_key = f"cm_{secrets.token_hex(32)}"
    key_hash = hash_token(raw_key)
    key_prefix = raw_key[:12]

    api_key = ApiKey(
        user_id=user.id,
        name=req.name.strip(),
        key_hash=key_hash,
        key_prefix=key_prefix,
    )
    db.add(api_key)
    db.commit()
    db.refresh(api_key)

    return ApiKeyCreatedResponse(
        id=api_key.id,
        name=api_key.name,
        key_prefix=api_key.key_prefix,
        key=raw_key,
        last_used_at=None,
        created_at=api_key.created_at.isoformat(),
    )


@router.delete("/{key_id}")
def delete_api_key(
    key_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    api_key = db.query(ApiKey).filter(ApiKey.id == key_id, ApiKey.user_id == user.id).first()
    if not api_key:
        raise HTTPException(status_code=404, detail="API key not found")
    db.delete(api_key)
    db.commit()
    return {"detail": "API key deleted"}
