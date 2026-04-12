from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.database import get_db
from app.models.app_settings import AppSettings
from app.models.email_template import EmailTemplate
from app.models.oidc_settings import OidcSettings
from app.models.smtp_settings import SmtpSettings
from app.models.user import User
from app.schemas.smtp import SmtpSettingsRequest, SmtpSettingsResponse, SmtpTestRequest
from app.utils.crypto import decrypt, encrypt

router = APIRouter()


def _to_response(s: SmtpSettings) -> SmtpSettingsResponse:
    return SmtpSettingsResponse(
        id=s.id,
        host=s.host,
        port=s.port,
        username=s.username,
        has_password=bool(s.password_encrypted),
        use_tls=s.use_tls,
        from_email=s.from_email,
        from_name=s.from_name,
        enabled=s.enabled,
    )


@router.get("", response_model=SmtpSettingsResponse | None)
def get_smtp_settings(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    s = db.query(SmtpSettings).first()
    if not s:
        return None
    return _to_response(s)


@router.put("", response_model=SmtpSettingsResponse)
def save_smtp_settings(
    req: SmtpSettingsRequest,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    s = db.query(SmtpSettings).first()
    is_new = s is None
    if not s:
        s = SmtpSettings()
        db.add(s)

    s.host = req.host
    s.port = req.port
    s.username = req.username
    s.use_tls = req.use_tls
    s.from_email = req.from_email
    s.from_name = req.from_name
    s.enabled = req.enabled

    if req.password is not None:
        s.password_encrypted = encrypt(req.password)

    # Auto-enable when all required fields are filled for the first time
    if is_new and not req.enabled and req.host and req.from_email and (req.password is not None):
        s.enabled = True

    db.commit()
    db.refresh(s)
    return _to_response(s)


@router.post("/test")
def test_smtp(
    req: SmtpTestRequest,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    s = db.query(SmtpSettings).first()
    if not s:
        raise HTTPException(status_code=400, detail="SMTP is not configured yet")

    from app.services.email_service import send_email

    try:
        password = decrypt(s.password_encrypted) if s.password_encrypted else None
        send_email(
            host=s.host,
            port=s.port,
            username=s.username,
            password=password,
            use_tls=s.use_tls,
            from_email=s.from_email,
            from_name=s.from_name or "CertDax",
            to_emails=[req.recipient],
            subject="CertDax - SMTP Test",
            body_html="<h2>SMTP Configuration Successful!</h2><p>If you receive this email, the SMTP configuration is working correctly.</p>",
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"SMTP test failed: {str(e)}")

    return {"detail": "Test email sent successfully" if s.enabled else "Test email sent successfully, but SMTP notifications are currently disabled. Enable the toggle to start sending notifications."}


# ---------- OIDC Settings ----------


class OidcSettingsRequest(BaseModel):
    enabled: bool = False
    provider_name: str = "oidc"
    display_name: str = "SSO"
    client_id: str = ""
    client_secret: str | None = None
    issuer_url: str = ""
    scopes: str = "openid profile email"
    auto_create_users: bool = True
    default_group_id: int | None = None
    admin_group: str | None = None
    group_claim: str = "groups"


class OidcSettingsResponse(BaseModel):
    id: int
    enabled: bool
    provider_name: str
    display_name: str
    client_id: str
    has_client_secret: bool
    issuer_url: str
    scopes: str
    auto_create_users: bool
    default_group_id: int | None
    admin_group: str | None
    group_claim: str


def _oidc_to_response(s: OidcSettings) -> OidcSettingsResponse:
    return OidcSettingsResponse(
        id=s.id,
        enabled=s.enabled,
        provider_name=s.provider_name,
        display_name=s.display_name,
        client_id=s.client_id,
        has_client_secret=bool(s.client_secret_encrypted),
        issuer_url=s.issuer_url,
        scopes=s.scopes,
        auto_create_users=s.auto_create_users,
        default_group_id=s.default_group_id,
        admin_group=s.admin_group,
        group_claim=s.group_claim,
    )


@router.get("/oidc", response_model=OidcSettingsResponse | None)
def get_oidc_settings(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    s = db.query(OidcSettings).first()
    if not s:
        return None
    return _oidc_to_response(s)


@router.put("/oidc", response_model=OidcSettingsResponse)
def save_oidc_settings(
    req: OidcSettingsRequest,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    s = db.query(OidcSettings).first()
    if not s:
        s = OidcSettings()
        db.add(s)

    s.enabled = req.enabled
    s.provider_name = req.provider_name
    s.display_name = req.display_name
    s.client_id = req.client_id
    s.issuer_url = req.issuer_url
    s.scopes = req.scopes
    s.auto_create_users = req.auto_create_users
    s.default_group_id = req.default_group_id
    s.admin_group = req.admin_group
    s.group_claim = req.group_claim

    if req.client_secret is not None:
        s.client_secret_encrypted = encrypt(req.client_secret)

    db.commit()
    db.refresh(s)
    return _oidc_to_response(s)


@router.post("/oidc/test")
def test_oidc(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Test OIDC configuration by fetching the discovery document."""
    s = db.query(OidcSettings).first()
    if not s:
        raise HTTPException(status_code=400, detail="OIDC is not configured yet")

    import httpx
    try:
        well_known = s.issuer_url.rstrip("/") + "/.well-known/openid-configuration"
        resp = httpx.get(well_known, timeout=10, follow_redirects=True)
        resp.raise_for_status()
        discovery = resp.json()
        return {
            "detail": "OIDC discovery successful",
            "issuer": discovery.get("issuer"),
            "authorization_endpoint": discovery.get("authorization_endpoint"),
            "token_endpoint": discovery.get("token_endpoint"),
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"OIDC test failed: {str(e)}")


# ---------- App Settings ----------


class AppSettingsRequest(BaseModel):
    default_cas_enabled: bool = True
    timezone: str = "UTC"


class AppSettingsResponse(BaseModel):
    default_cas_enabled: bool
    timezone: str


@router.get("/app", response_model=AppSettingsResponse)
def get_app_settings(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    s = db.query(AppSettings).first()
    if not s:
        return AppSettingsResponse(default_cas_enabled=True, timezone="UTC")
    return AppSettingsResponse(default_cas_enabled=s.default_cas_enabled, timezone=s.timezone or "UTC")


@router.put("/app", response_model=AppSettingsResponse)
def save_app_settings(
    req: AppSettingsRequest,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    s = db.query(AppSettings).first()
    if not s:
        s = AppSettings()
        db.add(s)

    s.default_cas_enabled = req.default_cas_enabled

    # Validate timezone
    from zoneinfo import ZoneInfo
    try:
        ZoneInfo(req.timezone)
    except Exception:
        raise HTTPException(status_code=400, detail=f"Invalid timezone: {req.timezone}")
    s.timezone = req.timezone

    # If disabling default CAs, deactivate them; if enabling, reactivate
    from app.models.certificate import CertificateAuthority
    from app.services.seed import DEFAULT_CAS

    default_urls = [ca["directory_url"] for ca in DEFAULT_CAS]
    default_cas = db.query(CertificateAuthority).filter(
        CertificateAuthority.directory_url.in_(default_urls)
    ).all()

    for ca in default_cas:
        ca.is_active = req.default_cas_enabled

    db.commit()
    db.refresh(s)
    return AppSettingsResponse(default_cas_enabled=s.default_cas_enabled, timezone=s.timezone or "UTC")


@router.get("/timezones")
def list_timezones(admin: User = Depends(require_admin)):
    from zoneinfo import available_timezones
    return sorted(available_timezones())


# ---------- Email Templates ----------

# Available variables per template (shown in UI for reference)
_TEMPLATE_VARIABLES: dict[str, list[str]] = {
    "password_reset": ["username", "reset_url"],
    "certificate_requested": ["common_name", "requested_by", "requested_at"],
    "certificate_issued": ["common_name", "expires_at", "issued_by", "issued_at"],
    "certificate_renewed": ["common_name", "expires_at", "renewed_by", "renewed_at"],
    "certificate_revoked": ["common_name"],
    "certificate_error": ["common_name", "error_message"],
    "certificate_expired": ["common_name"],
    "certificate_deleted": ["common_name", "deleted_by", "deleted_at"],
    "selfsigned_created": ["common_name", "created_by", "created_at"],
    "selfsigned_renewed": ["common_name", "renewed_by", "renewed_at"],
    "selfsigned_deleted": ["common_name", "deleted_by", "deleted_at"],
}


def _default_templates() -> dict[str, dict]:
    """Return all built-in default templates keyed by template_key."""
    return {
        "password_reset": {
            "subject": "CertDax — Reset Password",
            "body_html": (
                '<p>Hello {{username}},</p>'
                '<p>A request has been received to reset the password for your CertDax account.</p>'
                '<p style="text-align: center; margin: 30px 0;">'
                '  <a href="{{reset_url}}" style="background-color: #10b981; color: white; padding: 12px 32px; '
                'text-decoration: none; border-radius: 8px; font-weight: 600; display: inline-block;">'
                '    Reset Password'
                '  </a>'
                '</p>'
                '<p style="font-size: 14px; color: #64748b;">This link is valid for 1 hour. '
                'If you did not make this request, you can ignore this email.</p>'
            ),
        },
        "certificate_requested": {
            "subject": "Certificate requested: {{common_name}}",
            "body_html": (
                '<p>A new SSL certificate has been requested:</p>'
                '<table style="width: 100%; border-collapse: collapse;">'
                '  <tr><td style="padding: 8px 0; color: #64748b;">Domain</td>'
                '  <td style="padding: 8px 0; font-weight: 600;">{{common_name}}</td></tr>'
                '  <tr><td style="padding: 8px 0; color: #64748b;">Requested by</td>'
                '  <td style="padding: 8px 0; font-weight: 600;">{{requested_by}}</td></tr>'
                '  <tr><td style="padding: 8px 0; color: #64748b;">Requested at</td>'
                '  <td style="padding: 8px 0; font-weight: 600;">{{requested_at}}</td></tr>'
                '</table>'
            ),
        },
        "certificate_issued": {
            "subject": "Certificate issued: {{common_name}}",
            "body_html": (
                '<p>An SSL certificate has been successfully issued:</p>'
                '<table style="width: 100%; border-collapse: collapse;">'
                '  <tr><td style="padding: 8px 0; color: #64748b;">Domain</td>'
                '  <td style="padding: 8px 0; font-weight: 600;">{{common_name}}</td></tr>'
                '  <tr><td style="padding: 8px 0; color: #64748b;">Expires at</td>'
                '  <td style="padding: 8px 0; font-weight: 600;">{{expires_at}}</td></tr>'
                '  <tr><td style="padding: 8px 0; color: #64748b;">Issued by</td>'
                '  <td style="padding: 8px 0; font-weight: 600;">{{issued_by}}</td></tr>'
                '  <tr><td style="padding: 8px 0; color: #64748b;">Issued at</td>'
                '  <td style="padding: 8px 0; font-weight: 600;">{{issued_at}}</td></tr>'
                '</table>'
            ),
        },
        "certificate_renewed": {
            "subject": "Certificate renewed: {{common_name}}",
            "body_html": (
                '<p>An SSL certificate has been renewed:</p>'
                '<table style="width: 100%; border-collapse: collapse;">'
                '  <tr><td style="padding: 8px 0; color: #64748b;">Domain</td>'
                '  <td style="padding: 8px 0; font-weight: 600;">{{common_name}}</td></tr>'
                '  <tr><td style="padding: 8px 0; color: #64748b;">New expiry date</td>'
                '  <td style="padding: 8px 0; font-weight: 600;">{{expires_at}}</td></tr>'
                '  <tr><td style="padding: 8px 0; color: #64748b;">Renewed by</td>'
                '  <td style="padding: 8px 0; font-weight: 600;">{{renewed_by}}</td></tr>'
                '  <tr><td style="padding: 8px 0; color: #64748b;">Renewed at</td>'
                '  <td style="padding: 8px 0; font-weight: 600;">{{renewed_at}}</td></tr>'
                '</table>'
            ),
        },
        "certificate_revoked": {
            "subject": "Certificate revoked: {{common_name}}",
            "body_html": (
                '<p style="color: #dc2626;">An SSL certificate has been revoked:</p>'
                '<table style="width: 100%; border-collapse: collapse;">'
                '  <tr><td style="padding: 8px 0; color: #64748b;">Domain</td>'
                '  <td style="padding: 8px 0; font-weight: 600;">{{common_name}}</td></tr>'
                '</table>'
            ),
        },
        "certificate_error": {
            "subject": "Certificate error: {{common_name}}",
            "body_html": (
                '<p style="color: #dc2626;">An error occurred with a certificate:</p>'
                '<table style="width: 100%; border-collapse: collapse;">'
                '  <tr><td style="padding: 8px 0; color: #64748b;">Domain</td>'
                '  <td style="padding: 8px 0; font-weight: 600;">{{common_name}}</td></tr>'
                '  <tr><td style="padding: 8px 0; color: #64748b;">Error message</td>'
                '  <td style="padding: 8px 0; color: #dc2626;">{{error_message}}</td></tr>'
                '</table>'
            ),
        },
        "certificate_expired": {
            "subject": "Certificate expired: {{common_name}}",
            "body_html": (
                '<p style="color: #f59e0b;">An SSL certificate has expired:</p>'
                '<table style="width: 100%; border-collapse: collapse;">'
                '  <tr><td style="padding: 8px 0; color: #64748b;">Domain</td>'
                '  <td style="padding: 8px 0; font-weight: 600;">{{common_name}}</td></tr>'
                '</table>'
                '<p style="font-size: 14px;">Please renew this certificate as soon as possible.</p>'
            ),
        },
        "certificate_deleted": {
            "subject": "Certificate deleted: {{common_name}}",
            "body_html": (
                '<p style="color: #dc2626;">An SSL certificate has been deleted:</p>'
                '<table style="width: 100%; border-collapse: collapse;">'
                '  <tr><td style="padding: 8px 0; color: #64748b;">Domain</td>'
                '  <td style="padding: 8px 0; font-weight: 600;">{{common_name}}</td></tr>'
                '  <tr><td style="padding: 8px 0; color: #64748b;">Deleted by</td>'
                '  <td style="padding: 8px 0; font-weight: 600;">{{deleted_by}}</td></tr>'
                '  <tr><td style="padding: 8px 0; color: #64748b;">Deleted at</td>'
                '  <td style="padding: 8px 0; font-weight: 600;">{{deleted_at}}</td></tr>'
                '</table>'
            ),
        },
        "selfsigned_created": {
            "subject": "Self-signed certificate created: {{common_name}}",
            "body_html": (
                '<p>A new self-signed certificate has been created:</p>'
                '<table style="width: 100%; border-collapse: collapse;">'
                '  <tr><td style="padding: 8px 0; color: #64748b;">Domain</td>'
                '  <td style="padding: 8px 0; font-weight: 600;">{{common_name}}</td></tr>'
                '  <tr><td style="padding: 8px 0; color: #64748b;">Created by</td>'
                '  <td style="padding: 8px 0; font-weight: 600;">{{created_by}}</td></tr>'
                '  <tr><td style="padding: 8px 0; color: #64748b;">Created at</td>'
                '  <td style="padding: 8px 0; font-weight: 600;">{{created_at}}</td></tr>'
                '</table>'
            ),
        },
        "selfsigned_renewed": {
            "subject": "Self-signed certificate renewed: {{common_name}}",
            "body_html": (
                '<p>A self-signed certificate has been renewed:</p>'
                '<table style="width: 100%; border-collapse: collapse;">'
                '  <tr><td style="padding: 8px 0; color: #64748b;">Domain</td>'
                '  <td style="padding: 8px 0; font-weight: 600;">{{common_name}}</td></tr>'
                '  <tr><td style="padding: 8px 0; color: #64748b;">Renewed by</td>'
                '  <td style="padding: 8px 0; font-weight: 600;">{{renewed_by}}</td></tr>'
                '  <tr><td style="padding: 8px 0; color: #64748b;">Renewed at</td>'
                '  <td style="padding: 8px 0; font-weight: 600;">{{renewed_at}}</td></tr>'
                '</table>'
            ),
        },
        "selfsigned_deleted": {
            "subject": "Self-signed certificate deleted: {{common_name}}",
            "body_html": (
                '<p style="color: #dc2626;">A self-signed certificate has been deleted:</p>'
                '<table style="width: 100%; border-collapse: collapse;">'
                '  <tr><td style="padding: 8px 0; color: #64748b;">Domain</td>'
                '  <td style="padding: 8px 0; font-weight: 600;">{{common_name}}</td></tr>'
                '  <tr><td style="padding: 8px 0; color: #64748b;">Deleted by</td>'
                '  <td style="padding: 8px 0; font-weight: 600;">{{deleted_by}}</td></tr>'
                '  <tr><td style="padding: 8px 0; color: #64748b;">Deleted at</td>'
                '  <td style="padding: 8px 0; font-weight: 600;">{{deleted_at}}</td></tr>'
                '</table>'
            ),
        },
    }


class EmailTemplateItem(BaseModel):
    key: str
    subject: str
    body_html: str
    is_custom: bool
    variables: list[str]


class EmailTemplateUpdate(BaseModel):
    subject: str
    body_html: str


@router.get("/email-templates", response_model=list[EmailTemplateItem])
def list_email_templates(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    defaults = _default_templates()
    overrides = {
        t.template_key: t
        for t in db.query(EmailTemplate).all()
    }
    result = []
    for key, default in defaults.items():
        override = overrides.get(key)
        result.append(EmailTemplateItem(
            key=key,
            subject=override.subject if override else default["subject"],
            body_html=override.body_html if override else default["body_html"],
            is_custom=override is not None,
            variables=_TEMPLATE_VARIABLES.get(key, []),
        ))
    return result


@router.get("/email-templates/{key}", response_model=EmailTemplateItem)
def get_email_template(
    key: str,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    defaults = _default_templates()
    if key not in defaults:
        raise HTTPException(status_code=404, detail="Template not found")

    override = db.query(EmailTemplate).filter(EmailTemplate.template_key == key).first()
    default = defaults[key]
    return EmailTemplateItem(
        key=key,
        subject=override.subject if override else default["subject"],
        body_html=override.body_html if override else default["body_html"],
        is_custom=override is not None,
        variables=_TEMPLATE_VARIABLES.get(key, []),
    )


@router.put("/email-templates/{key}", response_model=EmailTemplateItem)
def save_email_template(
    key: str,
    req: EmailTemplateUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    defaults = _default_templates()
    if key not in defaults:
        raise HTTPException(status_code=404, detail="Template not found")

    override = db.query(EmailTemplate).filter(EmailTemplate.template_key == key).first()
    if not override:
        override = EmailTemplate(template_key=key)
        db.add(override)

    override.subject = req.subject
    override.body_html = req.body_html
    db.commit()
    db.refresh(override)

    return EmailTemplateItem(
        key=key,
        subject=override.subject,
        body_html=override.body_html,
        is_custom=True,
        variables=_TEMPLATE_VARIABLES.get(key, []),
    )


@router.delete("/email-templates/{key}")
def reset_email_template(
    key: str,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    defaults = _default_templates()
    if key not in defaults:
        raise HTTPException(status_code=404, detail="Template not found")

    override = db.query(EmailTemplate).filter(EmailTemplate.template_key == key).first()
    if override:
        db.delete(override)
        db.commit()

    return {"detail": "Template reset to default"}
