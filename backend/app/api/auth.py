from datetime import datetime, timedelta, timezone

import bcrypt as _bcrypt
from fastapi import APIRouter, Depends, HTTPException, Request
from jose import jwt, JWTError
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models.user import User
from app.models.group import Group
from app.schemas.auth import (
    LoginRequest,
    ProfileUpdateRequest,
    RegisterRequest,
    TokenResponse,
    UserResponse,
)
from app.api.deps import get_current_user

router = APIRouter()


def create_token(user_id: int) -> str:
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=settings.JWT_EXPIRY_MINUTES
    )
    return jwt.encode(
        {"sub": str(user_id), "exp": expire},
        settings.SECRET_KEY,
        algorithm=settings.JWT_ALGORITHM,
    )


@router.get("/needs-setup")
def needs_setup(db: Session = Depends(get_db)):
    has_users = db.query(User).first() is not None
    return {"needs_setup": not has_users}


@router.post("/register", response_model=TokenResponse)
def register(req: RegisterRequest, db: Session = Depends(get_db)):
    user_count = db.query(User).count()
    if user_count > 0:
        existing_user = db.query(User).first()
        raise HTTPException(
            status_code=400,
            detail="Registration closed. Please ask an admin to create your account.",
        )

    if db.query(User).filter(User.username == req.username).first():
        raise HTTPException(status_code=400, detail="Username already taken")

    pw_hash = _bcrypt.hashpw(req.password.encode(), _bcrypt.gensalt()).decode()
    default_group = db.query(Group).first()
    user = User(
        username=req.username,
        email=req.email,
        password_hash=pw_hash,
        is_admin=True,
        group_id=default_group.id if default_group else None,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    return TokenResponse(access_token=create_token(user.id))


@router.post("/login", response_model=TokenResponse)
def login(req: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == req.username).first()
    if not user:
        user = db.query(User).filter(User.username == req.username).first()
    if not user or not _bcrypt.checkpw(req.password.encode(), user.password_hash.encode()):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    return TokenResponse(access_token=create_token(user.id))


class ForgotPasswordRequest(BaseModel):
    email: str


class ResetPasswordRequest(BaseModel):
    token: str
    password: str


def _create_reset_token(user_id: int) -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=1)
    return jwt.encode(
        {"sub": str(user_id), "exp": expire, "purpose": "password_reset"},
        settings.SECRET_KEY,
        algorithm=settings.JWT_ALGORITHM,
    )


@router.post("/forgot-password")
def forgot_password(req: ForgotPasswordRequest, request: Request, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == req.email).first()
    # Always return success to prevent email enumeration
    if not user:
        return {"detail": "If the email address is registered, you will receive a reset link."}

    reset_token = _create_reset_token(user.id)
    user.password_reset_token = reset_token
    db.commit()

    # Derive frontend URL from the browser's Origin/Referer, fall back to config
    frontend_url = settings.FRONTEND_URL
    origin = request.headers.get("origin")
    referer = request.headers.get("referer")
    if origin:
        frontend_url = origin.rstrip("/")
    elif referer:
        from urllib.parse import urlparse
        parsed = urlparse(referer)
        frontend_url = f"{parsed.scheme}://{parsed.netloc}"

    reset_url = f"{frontend_url}/reset-password?token={reset_token}"

    from app.services.email_service import send_password_reset_email
    send_password_reset_email(
        to_email=user.email,
        username=user.display_name or user.username,
        reset_url=reset_url,
    )

    return {"detail": "If the email address is registered, you will receive a reset link."}


class VerifyResetTokenRequest(BaseModel):
    token: str


@router.post("/verify-reset-token")
def verify_reset_token(req: VerifyResetTokenRequest, db: Session = Depends(get_db)):
    try:
        payload = jwt.decode(
            req.token,
            settings.SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM],
        )
        if payload.get("purpose") != "password_reset":
            raise HTTPException(status_code=400, detail="Invalid reset link")
        user_id = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=400, detail="Invalid reset link")
    except JWTError:
        raise HTTPException(status_code=400, detail="Reset link has expired or is invalid")

    user = db.query(User).filter(User.id == int(user_id)).first()
    if not user:
        raise HTTPException(status_code=400, detail="User not found")

    if user.password_reset_token != req.token:
        raise HTTPException(status_code=400, detail="This reset link has already been used")

    return {"valid": True}


@router.post("/reset-password")
def reset_password(req: ResetPasswordRequest, db: Session = Depends(get_db)):
    try:
        payload = jwt.decode(
            req.token,
            settings.SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM],
        )
        if payload.get("purpose") != "password_reset":
            raise HTTPException(status_code=400, detail="Invalid reset link")
        user_id = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=400, detail="Invalid reset link")
    except JWTError:
        raise HTTPException(status_code=400, detail="Reset link has expired or is invalid")

    user = db.query(User).filter(User.id == int(user_id)).first()
    if not user:
        raise HTTPException(status_code=400, detail="User not found")

    if user.password_reset_token != req.token:
        raise HTTPException(status_code=400, detail="Reset link has already been used")

    user.password_hash = _bcrypt.hashpw(req.password.encode(), _bcrypt.gensalt()).decode()
    user.password_reset_token = None
    db.commit()
    return {"detail": "Password changed successfully"}


@router.get("/me", response_model=UserResponse)
def get_me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    group_name = None
    if user.group_id:
        group = db.query(Group).filter(Group.id == user.group_id).first()
        if group:
            group_name = group.name
    return UserResponse(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
        email=user.email,
        is_admin=user.is_admin,
        group_id=user.group_id,
        group_name=group_name,
        profile_image=user.profile_image,
    )


@router.put("/me", response_model=UserResponse)
def update_profile(
    req: ProfileUpdateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if req.display_name is not None:
        user.display_name = req.display_name
    elif "display_name" in req.model_fields_set:
        user.display_name = None
    if req.email is not None:
        user.email = req.email
    if req.password is not None:
        user.password_hash = _bcrypt.hashpw(req.password.encode(), _bcrypt.gensalt()).decode()
    if req.profile_image is not None:
        # Limit to 2MB base64
        if len(req.profile_image) > 2_000_000:
            raise HTTPException(status_code=400, detail="Profielfoto is te groot (max 2MB)")
        user.profile_image = req.profile_image
    elif "profile_image" in req.model_fields_set:
        user.profile_image = None

    db.commit()
    db.refresh(user)

    group_name = None
    if user.group_id:
        group = db.query(Group).filter(Group.id == user.group_id).first()
        if group:
            group_name = group.name
    return UserResponse(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
        email=user.email,
        is_admin=user.is_admin,
        group_id=user.group_id,
        group_name=group_name,
        profile_image=user.profile_image,
    )
