import bcrypt as _bcrypt
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.auth import create_token
from app.database import get_db
from app.models.group import Group
from app.models.smtp_settings import SmtpSettings
from app.models.user import User
from app.utils.crypto import encrypt

router = APIRouter()


class SetupAdminRequest(BaseModel):
    username: str
    email: str
    password: str


class SetupSmtpRequest(BaseModel):
    host: str
    port: int = 587
    username: str | None = None
    password: str | None = None
    use_tls: bool = True
    from_email: str
    from_name: str | None = None


class SetupRequest(BaseModel):
    admin: SetupAdminRequest
    smtp: SetupSmtpRequest | None = None
    default_cas_enabled: bool = True
    acme_contact_email: str | None = None


@router.get("/status")
def setup_status(db: Session = Depends(get_db)):
    """Check if setup has been completed."""
    has_users = db.query(User).first() is not None
    return {"needs_setup": not has_users}


@router.post("/complete")
def complete_setup(req: SetupRequest, db: Session = Depends(get_db)):
    """Complete the initial setup: create admin account and optionally configure SMTP."""
    # Ensure setup hasn't already been completed
    if db.query(User).first() is not None:
        raise HTTPException(status_code=400, detail="Setup has already been completed")

    # Ensure default group exists
    default_group = db.query(Group).first()
    if not default_group:
        default_group = Group(name="Default")
        db.add(default_group)
        db.flush()

    # Create admin user
    pw_hash = _bcrypt.hashpw(req.admin.password.encode(), _bcrypt.gensalt()).decode()
    user = User(
        username=req.admin.username,
        email=req.admin.email,
        password_hash=pw_hash,
        is_admin=True,
        group_id=default_group.id,
    )
    db.add(user)

    # Optionally configure SMTP
    if req.smtp:
        smtp = db.query(SmtpSettings).first()
        if not smtp:
            smtp = SmtpSettings()
            db.add(smtp)
        smtp.host = req.smtp.host
        smtp.port = req.smtp.port
        smtp.username = req.smtp.username
        smtp.use_tls = req.smtp.use_tls
        smtp.from_email = req.smtp.from_email
        smtp.from_name = req.smtp.from_name
        smtp.enabled = True
        if req.smtp.password:
            smtp.password_encrypted = encrypt(req.smtp.password)

    # Apply default CAs setting
    from app.models.app_settings import AppSettings
    app_settings = db.query(AppSettings).first()
    if not app_settings:
        app_settings = AppSettings()
        db.add(app_settings)
    app_settings.default_cas_enabled = req.default_cas_enabled

    # If default CAs disabled, deactivate them
    if not req.default_cas_enabled:
        from app.models.certificate import CertificateAuthority
        from app.services.seed import DEFAULT_CAS
        default_urls = [ca["directory_url"] for ca in DEFAULT_CAS]
        for ca in db.query(CertificateAuthority).filter(
            CertificateAuthority.directory_url.in_(default_urls)
        ).all():
            ca.is_active = False

    # Set ACME contact email on default CAs (write to CaGroupAccount for global CAs)
    if req.acme_contact_email:
        from app.models.certificate import CertificateAuthority
        from app.models.ca_group_account import CaGroupAccount
        from app.services.seed import DEFAULT_CAS
        default_urls = [ca["directory_url"] for ca in DEFAULT_CAS]
        for ca in db.query(CertificateAuthority).filter(
            CertificateAuthority.directory_url.in_(default_urls)
        ).all():
            override = db.query(CaGroupAccount).filter(
                CaGroupAccount.ca_id == ca.id,
                CaGroupAccount.group_id == default_group.id,
            ).first()
            if not override:
                override = CaGroupAccount(ca_id=ca.id, group_id=default_group.id)
                db.add(override)
            override.contact_email = req.acme_contact_email

    db.commit()
    db.refresh(user)

    token = create_token(user.id)
    return {"access_token": token}
