import asyncio
import json
import logging
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.config import settings
from app.database import SessionLocal
from app.models.ca_group_account import CaGroupAccount
from app.models.certificate import Certificate, CertificateAuthority
from app.models.deployment import AgentCertificate, CertificateDeployment
from app.models.provider import DnsProvider
from app.models.user import User
from app.services.acme_service import AcmeClient
from app.services.dns_providers import get_dns_provider
from app.utils.crypto import (
    decrypt,
    encrypt,
    generate_ec_key,
    load_private_key,
    parse_certificate_dates,
    serialize_private_key,
)

logger = logging.getLogger(__name__)


async def process_certificate_request(cert_id: int):
    db = SessionLocal()
    try:
        # Atomic status transition: only proceed if status is still pending/renewing
        rows = (
            db.query(Certificate)
            .filter(
                Certificate.id == cert_id,
                Certificate.status.in_(["pending", "renewing"]),
            )
            .update({"status": "processing"}, synchronize_session="fetch")
        )
        db.commit()
        if rows == 0:
            logger.info(f"Certificate {cert_id} already being processed by another instance")
            return

        cert = db.query(Certificate).filter(Certificate.id == cert_id).first()
        if not cert:
            logger.error(f"Certificate {cert_id} not found")
            return

        ca = (
            db.query(CertificateAuthority)
            .filter(CertificateAuthority.id == cert.ca_id)
            .first()
        )
        if not ca:
            raise RuntimeError("Certificate Authority not found")

        # For global CAs, load per-group account override
        override = None
        if ca.group_id is None and cert.group_id:
            override = db.query(CaGroupAccount).filter(
                CaGroupAccount.ca_id == ca.id,
                CaGroupAccount.group_id == cert.group_id,
            ).first()

        acct_key_pem = (override.account_key_pem if override else None) if ca.group_id is None else ca.account_key_pem
        acct_url = (override.account_url if override else None) if ca.group_id is None else ca.account_url
        acct_email = (override.contact_email if override else None) if ca.group_id is None else ca.contact_email

        if acct_key_pem:
            account_key = load_private_key(decrypt(acct_key_pem))
        else:
            account_key = generate_ec_key()
            # Save the new key
            if ca.group_id is None:
                if not override:
                    override = CaGroupAccount(ca_id=ca.id, group_id=cert.group_id)
                    db.add(override)
                override.account_key_pem = encrypt(serialize_private_key(account_key))
            else:
                ca.account_key_pem = encrypt(serialize_private_key(account_key))
            db.commit()

        acme = AcmeClient(ca.directory_url)
        acme.account_key = account_key

        try:
            if acct_url:
                acme.account_url = acct_url
                await acme.find_account()
            else:
                contact_email = acct_email or settings.ACME_CONTACT_EMAIL
                if not contact_email:
                    raise ValueError(
                        "No contact email address configured. "
                        "Set ACME_CONTACT_EMAIL in your .env or configure it on the Certificate Authority."
                    )
                account_url = await acme.register_account(
                    contact_email,
                    eab_kid=decrypt(ca.eab_kid) if ca.eab_kid else None,
                    eab_hmac_key=decrypt(ca.eab_hmac_key) if ca.eab_hmac_key else None,
                )
                if ca.group_id is None:
                    if not override:
                        override = CaGroupAccount(ca_id=ca.id, group_id=cert.group_id)
                        db.add(override)
                    override.account_url = account_url
                else:
                    ca.account_url = account_url
                db.commit()

            dns_provider_instance = None
            if cert.dns_provider_id:
                dns_prov = (
                    db.query(DnsProvider)
                    .filter(DnsProvider.id == cert.dns_provider_id)
                    .first()
                )
                if dns_prov and dns_prov.credentials_encrypted:
                    creds = json.loads(decrypt(dns_prov.credentials_encrypted))
                    dns_provider_instance = get_dns_provider(
                        dns_prov.provider_type, creds
                    )

            domains = [cert.common_name]
            if cert.san_domains:
                san_list = json.loads(cert.san_domains)
                for d in san_list:
                    if d != cert.common_name:
                        domains.append(d)

            custom_oids = None
            if cert.custom_oids:
                custom_oids = json.loads(cert.custom_oids)

            key_pem, cert_pem, chain_pem = await acme.request_certificate(
                domains=domains,
                challenge_type=cert.challenge_type,
                dns_provider=dns_provider_instance,
                custom_oids=custom_oids,
            )

            issued_at, expires_at = parse_certificate_dates(cert_pem)

            cert.certificate_pem = cert_pem
            cert.private_key_pem_encrypted = encrypt(key_pem)
            cert.chain_pem = chain_pem
            cert.issued_at = issued_at
            cert.expires_at = expires_at
            cert.status = "valid"
            cert.error_message = None
            db.commit()

            # Auto-deploy to all assigned agents
            _create_pending_deployments_acme(db, cert_id)

            # Determine who triggered this
            _user_id = cert.modified_by_user_id or cert.created_by_user_id
            _user = db.query(User).filter(User.id == _user_id).first() if _user_id else None
            _username = (_user.display_name or _user.username) if _user else ""
            from app.utils.time import format_now
            _now = format_now()
            _is_renewal = cert.modified_by_user_id is not None

            # In-app notification
            from app.services.notification_service import create_notification
            if _is_renewal:
                create_notification(
                    group_id=cert.group_id,
                    type="cert_renewed",
                    resource_type="certificate",
                    resource_id=cert.id,
                    title=f"Certificate renewed: {cert.common_name}",
                    message=f"Certificate {cert.common_name} was renewed by {_username or 'System (auto-renewal)'}.",
                    actor=_username or "System (auto-renewal)",
                    db=db,
                )
            else:
                create_notification(
                    group_id=cert.group_id,
                    type="cert_issued",
                    resource_type="certificate",
                    resource_id=cert.id,
                    title=f"Certificate issued: {cert.common_name}",
                    message=f"Certificate {cert.common_name} was issued by {_username or 'System'}.",
                    actor=_username or "System",
                    db=db,
                )

            # Email notification
            if _is_renewal:
                from app.services.email_service import notify_certificate_renewed
                _validity_days = (expires_at - issued_at).days if issued_at and expires_at else ""
                notify_certificate_renewed(
                    group_id=cert.group_id,
                    common_name=cert.common_name,
                    expires_at=expires_at.strftime("%Y-%m-%d") if expires_at else "Unknown",
                    renewed_by=_username,
                    renewed_at=_now,
                    validity_days=_validity_days,
                )
            else:
                from app.services.email_service import notify_certificate_issued
                notify_certificate_issued(
                    group_id=cert.group_id,
                    common_name=cert.common_name,
                    expires_at=expires_at.strftime("%Y-%m-%d") if expires_at else "Unknown",
                    issued_by=_username,
                    issued_at=_now,
                )

            logger.info(f"Certificate {cert_id} issued successfully for {domains}")

        finally:
            await acme.close()

    except Exception as e:
        logger.exception(f"Certificate request failed for cert {cert_id}")
        try:
            cert = db.query(Certificate).filter(Certificate.id == cert_id).first()
            if cert:
                cert.status = "error"
                cert.error_message = str(e)[:1000]
                cert.last_renewal_attempt = datetime.now(timezone.utc)
                db.commit()

                from app.services.email_service import notify_certificate_error
                notify_certificate_error(
                    group_id=cert.group_id,
                    common_name=cert.common_name,
                    error_message=str(e)[:200],
                )

                from app.services.notification_service import create_notification
                create_notification(
                    group_id=cert.group_id,
                    type="cert_error",
                    resource_type="certificate",
                    resource_id=cert.id,
                    title=f"Certificate error: {cert.common_name}",
                    message=f"Certificate request for {cert.common_name} failed: {str(e)[:200]}",
                    actor="System",
                    db=db,
                )
        except Exception:
            pass
    finally:
        db.close()


def trigger_certificate_request(cert_id: int):
    loop = asyncio.new_event_loop()

    def run():
        loop.run_until_complete(process_certificate_request(cert_id))
        loop.close()

    import threading

    thread = threading.Thread(target=run, daemon=True)
    thread.start()


def _create_pending_deployments_acme(db: Session, cert_id: int):
    """Replace old deployments and create new pending ones for all agents assigned to this ACME cert."""
    # Remove old deployments for this cert so renewals replace them
    db.query(CertificateDeployment).filter(
        CertificateDeployment.certificate_id == cert_id,
    ).delete()

    assignments = (
        db.query(AgentCertificate)
        .filter(
            AgentCertificate.certificate_id == cert_id,
            AgentCertificate.auto_deploy == True,  # noqa: E712
        )
        .all()
    )
    for ac in assignments:
        dep = CertificateDeployment(
            certificate_id=cert_id,
            target_id=ac.target_id,
            status="pending",
            deploy_format=ac.deploy_format,
        )
        db.add(dep)
    db.commit()


async def process_certificate_revoke(cert_id: int):
    db = SessionLocal()
    try:
        # Atomic status transition: only proceed if status is still 'revoking'
        rows = (
            db.query(Certificate)
            .filter(
                Certificate.id == cert_id,
                Certificate.status == "revoking",
            )
            .update({"status": "revoking"}, synchronize_session="fetch")
        )
        db.commit()
        if rows == 0:
            logger.info(f"Certificate {cert_id} revoke already handled by another instance")
            return

        cert = db.query(Certificate).filter(Certificate.id == cert_id).first()
        if not cert or not cert.certificate_pem:
            logger.error(f"Certificate {cert_id} not found or not issued")
            return

        ca = (
            db.query(CertificateAuthority)
            .filter(CertificateAuthority.id == cert.ca_id)
            .first()
        )
        if not ca:
            raise RuntimeError("Certificate Authority not found")

        if not ca.account_key_pem:
            raise RuntimeError("No ACME account key – cannot revoke")

        account_key = load_private_key(decrypt(ca.account_key_pem))

        acme = AcmeClient(ca.directory_url)
        acme.account_key = account_key

        try:
            if ca.account_url:
                acme.account_url = ca.account_url
                await acme.find_account()
            else:
                raise RuntimeError("No ACME account registered – cannot revoke")

            await acme.revoke_certificate(cert.certificate_pem)

            cert.status = "revoked"
            cert.error_message = None
            db.commit()

            from app.services.email_service import notify_certificate_revoked
            from app.services.notification_service import create_notification
            notify_certificate_revoked(
                group_id=cert.group_id,
                common_name=cert.common_name,
            )
            create_notification(
                group_id=cert.group_id,
                type="cert_revoked",
                resource_type="certificate",
                resource_id=cert.id,
                title=f"Certificate revoked: {cert.common_name}",
                message=f"Certificate {cert.common_name} has been revoked.",
                actor="system",
                db=db,
            )

            logger.info(f"Certificate {cert_id} revoked successfully")

        finally:
            await acme.close()

    except Exception as e:
        logger.exception(f"Certificate revoke failed for cert {cert_id}")
        try:
            cert = db.query(Certificate).filter(Certificate.id == cert_id).first()
            if cert:
                cert.status = "error"
                cert.error_message = f"Revoke failed: {str(e)[:500]}"
                db.commit()
        except Exception:
            pass
    finally:
        db.close()


def trigger_certificate_revoke(cert_id: int):
    loop = asyncio.new_event_loop()

    def run():
        loop.run_until_complete(process_certificate_revoke(cert_id))
        loop.close()

    import threading

    thread = threading.Thread(target=run, daemon=True)
    thread.start()
