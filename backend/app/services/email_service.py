import logging
import re
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models.group_share import GroupShare
from app.models.smtp_settings import SmtpSettings
from app.models.user import User
from app.utils.crypto import decrypt

logger = logging.getLogger(__name__)


def send_email(
    host: str,
    port: int,
    username: str | None,
    password: str | None,
    use_tls: bool,
    from_email: str,
    from_name: str,
    to_emails: list[str],
    subject: str,
    body_html: str,
    bcc: bool = False,
):
    if bcc:
        for recipient in to_emails:
            individual_msg = MIMEMultipart("alternative")
            individual_msg["Subject"] = subject
            individual_msg["From"] = f"{from_name} <{from_email}>"
            individual_msg["To"] = recipient
            individual_msg.attach(MIMEText(body_html, "html"))

            if use_tls:
                server = smtplib.SMTP(host, port, timeout=15)
                server.starttls()
            else:
                server = smtplib.SMTP(host, port, timeout=15)

            try:
                if username and password:
                    server.login(username, password)
                server.sendmail(from_email, [recipient], individual_msg.as_string())
            finally:
                server.quit()
        return

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{from_name} <{from_email}>"
    msg["To"] = ", ".join(to_emails)
    msg.attach(MIMEText(body_html, "html"))

    if use_tls:
        server = smtplib.SMTP(host, port, timeout=15)
        server.starttls()
    else:
        server = smtplib.SMTP(host, port, timeout=15)

    try:
        if username and password:
            server.login(username, password)
        server.sendmail(from_email, to_emails, msg.as_string())
    finally:
        server.quit()


def _get_smtp_config(db: Session) -> dict | None:
    s = db.query(SmtpSettings).first()
    if not s or not s.enabled:
        return None
    return {
        "host": s.host,
        "port": s.port,
        "username": s.username,
        "password": decrypt(s.password_encrypted) if s.password_encrypted else None,
        "use_tls": s.use_tls,
        "from_email": s.from_email,
        "from_name": s.from_name or "CertDax",
    }


def _get_group_emails(db: Session, group_id: int | None) -> list[str]:
    if group_id is None:
        return []
    users = db.query(User).filter(User.group_id == group_id).all()
    return [u.email for u in users if u.email]


def _get_all_related_group_ids(db: Session, group_id: int, resource_type: str | None) -> list[int]:
    """Return group_id plus groups the owner has shared this resource_type with."""
    group_ids = {group_id}
    if resource_type:
        # Groups that this group shares the resource with (owner → target)
        targets = (
            db.query(GroupShare.target_group_id)
            .filter(GroupShare.owner_group_id == group_id, GroupShare.resource_type == resource_type)
            .all()
        )
        group_ids.update(t[0] for t in targets)
    return list(group_ids)


def _send_notification(group_id: int | None, subject: str, body_html: str, resource_type: str | None = None):
    db = SessionLocal()
    try:
        cfg = _get_smtp_config(db)
        if not cfg:
            return

        if group_id is None:
            return

        all_group_ids = _get_all_related_group_ids(db, group_id, resource_type)
        recipients = []
        for gid in all_group_ids:
            recipients.extend(_get_group_emails(db, gid))
        # Deduplicate while preserving order
        seen = set()
        unique_recipients = []
        for email in recipients:
            if email not in seen:
                seen.add(email)
                unique_recipients.append(email)

        if not unique_recipients:
            return

        send_email(
            host=cfg["host"],
            port=cfg["port"],
            username=cfg["username"],
            password=cfg["password"],
            use_tls=cfg["use_tls"],
            from_email=cfg["from_email"],
            from_name=cfg["from_name"],
            to_emails=unique_recipients,
            subject=subject,
            body_html=body_html,
            bcc=True,
        )
        logger.info(f"Notification sent to {len(unique_recipients)} recipients: {subject}")
    except Exception:
        logger.exception(f"Failed to send notification: {subject}")
    finally:
        db.close()


def _base_template(title: str, content: str) -> str:
    return f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: #0f172a; color: white; padding: 20px 24px; border-radius: 12px 12px 0 0;">
        <h2 style="margin: 0; font-size: 18px;">🔒 CertDax</h2>
      </div>
      <div style="background: #ffffff; border: 1px solid #e2e8f0; border-top: none; padding: 24px; border-radius: 0 0 12px 12px;">
        <h3 style="margin-top: 0; color: #1e293b;">{title}</h3>
        {content}
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
        <p style="font-size: 12px; color: #94a3b8; margin-bottom: 0;">
          This notification was automatically sent by CertDax.
        </p>
      </div>
    </div>
    """


def _render_template(template_key: str, variables: dict[str, str]) -> tuple[str, str]:
    """Load a template (custom override or default) and render it with variables.

    Returns (subject, full_html) with {{var}} placeholders replaced.
    """
    from app.models.email_template import EmailTemplate
    from app.api.settings import _default_templates

    defaults = _default_templates()
    default = defaults.get(template_key, {"subject": template_key, "body_html": ""})

    db = SessionLocal()
    try:
        override = db.query(EmailTemplate).filter(EmailTemplate.template_key == template_key).first()
        if override:
            subject = override.subject
            body_html = override.body_html
        else:
            subject = default["subject"]
            body_html = default["body_html"]
    finally:
        db.close()

    # Replace {{variable}} placeholders — only allow known variable names
    def _replace(text: str) -> str:
        def _sub(match: re.Match) -> str:
            var_name = match.group(1).strip()
            return variables.get(var_name, match.group(0))
        return re.sub(r"\{\{(\s*\w+\s*)\}\}", _sub, text)

    subject = _replace(subject)
    body_html = _replace(body_html)

    # Extract title from subject for the base wrapper
    title = subject.split(": ", 1)[-1] if ": " in subject else subject
    full_html = _base_template(title, body_html)

    return subject, full_html


def send_password_reset_email(to_email: str, username: str, reset_url: str):
    """Send a password reset email directly to a specific user."""
    db = SessionLocal()
    try:
        config = _get_smtp_config(db)
        if not config:
            logger.warning("SMTP not configured — cannot send password reset email")
            return

        subject, body_html = _render_template("password_reset", {
            "username": username,
            "reset_url": reset_url,
        })

        send_email(
            host=config["host"],
            port=config["port"],
            username=config["username"],
            password=config["password"],
            use_tls=config["use_tls"],
            from_email=config["from_email"],
            from_name=config["from_name"],
            to_emails=[to_email],
            subject=subject,
            body_html=body_html,
        )
        logger.info(f"Password reset email sent to {to_email}")
    except Exception as e:
        logger.error(f"Failed to send password reset email: {e}")
    finally:
        db.close()


def notify_certificate_requested(
    group_id: int | None,
    common_name: str,
    requested_by: str,
    requested_at: str = "",
):
    subject, body_html = _render_template("certificate_requested", {
        "common_name": common_name,
        "requested_by": requested_by,
        "requested_at": requested_at,
    })
    _send_notification(group_id, subject, body_html, resource_type="certificates")


def notify_certificate_issued(
    group_id: int | None,
    common_name: str,
    expires_at: str,
    issued_by: str = "",
    issued_at: str = "",
):
    subject, body_html = _render_template("certificate_issued", {
        "common_name": common_name,
        "expires_at": expires_at,
        "issued_by": issued_by,
        "issued_at": issued_at,
    })
    _send_notification(group_id, subject, body_html, resource_type="certificates")


def notify_certificate_renewed(
    group_id: int | None,
    common_name: str,
    expires_at: str,
    renewed_by: str = "",
    renewed_at: str = "",
    validity_days: int | str = "",
):
    subject, body_html = _render_template("certificate_renewed", {
        "common_name": common_name,
        "expires_at": expires_at,
        "renewed_by": renewed_by,
        "renewed_at": renewed_at,
        "validity_days": str(validity_days),
    })
    _send_notification(group_id, subject, body_html, resource_type="certificates")


def notify_certificate_revoked(
    group_id: int | None,
    common_name: str,
):
    subject, body_html = _render_template("certificate_revoked", {
        "common_name": common_name,
    })
    _send_notification(group_id, subject, body_html, resource_type="certificates")


def notify_certificate_error(
    group_id: int | None,
    common_name: str,
    error_message: str,
):
    subject, body_html = _render_template("certificate_error", {
        "common_name": common_name,
        "error_message": error_message,
    })
    _send_notification(group_id, subject, body_html, resource_type="certificates")


def notify_certificate_expired(
    group_id: int | None,
    common_name: str,
):
    subject, body_html = _render_template("certificate_expired", {
        "common_name": common_name,
    })
    _send_notification(group_id, subject, body_html, resource_type="certificates")


def notify_selfsigned_created(
    group_id: int | None,
    common_name: str,
    created_by: str,
    created_at: str = "",
):
    subject, body_html = _render_template("selfsigned_created", {
        "common_name": common_name,
        "created_by": created_by,
        "created_at": created_at,
    })
    _send_notification(group_id, subject, body_html, resource_type="self_signed")


def notify_selfsigned_renewed(
    group_id: int | None,
    common_name: str,
    renewed_by: str = "",
    renewed_at: str = "",
    validity_days: int | str = "",
):
    subject, body_html = _render_template("selfsigned_renewed", {
        "common_name": common_name,
        "renewed_by": renewed_by,
        "renewed_at": renewed_at,
        "validity_days": str(validity_days),
    })
    _send_notification(group_id, subject, body_html, resource_type="self_signed")


def notify_certificate_deleted(
    group_id: int | None,
    common_name: str,
    deleted_by: str,
    deleted_at: str = "",
):
    subject, body_html = _render_template("certificate_deleted", {
        "common_name": common_name,
        "deleted_by": deleted_by,
        "deleted_at": deleted_at,
    })
    _send_notification(group_id, subject, body_html, resource_type="certificates")


def notify_selfsigned_deleted(
    group_id: int | None,
    common_name: str,
    deleted_by: str,
    deleted_at: str = "",
):
    subject, body_html = _render_template("selfsigned_deleted", {
        "common_name": common_name,
        "deleted_by": deleted_by,
        "deleted_at": deleted_at,
    })
    _send_notification(group_id, subject, body_html, resource_type="self_signed")
