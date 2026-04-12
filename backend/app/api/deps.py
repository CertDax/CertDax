from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models.api_key import ApiKey
from app.models.deployment import DeploymentTarget
from app.models.group_share import GroupShare
from app.models.user import User
from app.utils.crypto import hash_token

security = HTTPBearer()


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
) -> User:
    token = credentials.credentials

    # Try JWT first
    try:
        payload = jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM],
        )
        user_id = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid token")
        user = db.query(User).filter(User.id == int(user_id)).first()
        if user is None:
            raise HTTPException(status_code=401, detail="User not found")
        return user
    except JWTError:
        pass

    # Fall back to API key
    token_hash = hash_token(token)
    api_key = db.query(ApiKey).filter(ApiKey.key_hash == token_hash).first()
    if api_key:
        from datetime import datetime, timezone
        api_key.last_used_at = datetime.now(timezone.utc)
        db.commit()
        user = db.query(User).filter(User.id == api_key.user_id).first()
        if user:
            return user

    raise HTTPException(status_code=401, detail="Invalid token")


def require_admin(user: User = Depends(get_current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


def get_agent_target(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
) -> DeploymentTarget:
    token_hash = hash_token(credentials.credentials)
    target = (
        db.query(DeploymentTarget)
        .filter(DeploymentTarget.agent_token_hash == token_hash)
        .first()
    )
    if target is None:
        raise HTTPException(status_code=401, detail="Invalid agent token")
    return target


def visible_group_ids(db: Session, user: User, resource_type: str) -> list[int]:
    """Return group IDs the user can see for a given resource type.

    Includes the user's own group plus any groups that share this resource type
    with the user's group.
    """
    own = user.group_id
    if own is None:
        return []
    shared = (
        db.query(GroupShare.owner_group_id)
        .filter(
            GroupShare.target_group_id == own,
            GroupShare.resource_type == resource_type,
        )
        .all()
    )
    return [own] + [row[0] for row in shared]
