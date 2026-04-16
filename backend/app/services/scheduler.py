import logging
from datetime import datetime, timedelta, timezone

from apscheduler.schedulers.background import BackgroundScheduler

from app.config import settings
from app.database import SessionLocal
from app.models.certificate import Certificate
from app.models.selfsigned import SelfSignedCertificate
from app.utils.distributed_lock import try_acquire_lock, release_lock

logger = logging.getLogger(__name__)

_scheduler: BackgroundScheduler | None = None


def check_renewals():
    if not try_acquire_lock("scheduler:check_renewals", ttl_seconds=600):
        logger.debug("check_renewals: skipped, another instance holds the lock")
        return
    try:
        _do_check_renewals()
    finally:
        release_lock("scheduler:check_renewals")


def _do_check_renewals():
    db = SessionLocal()
    try:
        global_threshold = settings.RENEWAL_THRESHOLD_DAYS
        now = datetime.now(timezone.utc)

        # Fetch all auto-renew certs that are valid and have an expiry date
        certs = (
            db.query(Certificate)
            .filter(
                Certificate.auto_renew.is_(True),
                Certificate.status == "valid",
                Certificate.expires_at.isnot(None),
            )
            .all()
        )

        for cert in certs:
            threshold_days = cert.renewal_threshold_days if cert.renewal_threshold_days is not None else global_threshold
            threshold_dt = now + timedelta(days=threshold_days)
            if cert.expires_at <= threshold_dt:
                logger.info(
                    f"Certificate {cert.id} ({cert.common_name}) expiring at "
                    f"{cert.expires_at}, threshold {threshold_days}d, triggering renewal"
                )
                from app.services.certificate_service import trigger_certificate_request

                cert.status = "renewing"
                db.commit()
                trigger_certificate_request(cert.id)

    except Exception:
        logger.exception("Renewal check failed")
    finally:
        db.close()


def check_expired():
    if not try_acquire_lock("scheduler:check_expired", ttl_seconds=300):
        logger.debug("check_expired: skipped, another instance holds the lock")
        return
    try:
        _do_check_expired()
    finally:
        release_lock("scheduler:check_expired")


def _do_check_expired():
    db = SessionLocal()
    try:
        now = datetime.now(timezone.utc)

        # ACME certificates
        expired = (
            db.query(Certificate)
            .filter(
                Certificate.status == "valid",
                Certificate.expires_at <= now,
            )
            .all()
        )
        for cert in expired:
            cert.status = "expired"
            logger.warning(f"Certificate {cert.id} ({cert.common_name}) has expired")

            from app.services.email_service import notify_certificate_expired
            notify_certificate_expired(
                group_id=cert.group_id,
                common_name=cert.common_name,
            )

            from app.services.notification_service import create_notification
            create_notification(
                group_id=cert.group_id,
                type="cert_expired",
                resource_type="certificate",
                resource_id=cert.id,
                title=f"Certificate expired: {cert.common_name}",
                message=f"Certificate {cert.common_name} has expired.",
                actor="System",
                db=db,
            )

        # Self-signed certificates
        expired_ss = (
            db.query(SelfSignedCertificate)
            .filter(
                SelfSignedCertificate.expires_at <= now,
                SelfSignedCertificate.expires_at.isnot(None),
            )
            .all()
        )
        for cert in expired_ss:
            logger.warning(f"Self-signed certificate {cert.id} ({cert.common_name}) has expired")

            from app.services.email_service import notify_selfsigned_expired
            notify_selfsigned_expired(
                group_id=cert.group_id,
                common_name=cert.common_name,
            )

            from app.services.notification_service import create_notification
            create_notification(
                group_id=cert.group_id,
                type="cert_expired",
                resource_type="selfsigned",
                resource_id=cert.id,
                title=f"Self-signed expired: {cert.common_name}",
                message=f"Self-signed certificate {cert.common_name} has expired.",
                actor="System",
                db=db,
            )

        db.commit()
    except Exception:
        logger.exception("Expired check failed")
    finally:
        db.close()


def check_selfsigned_renewals():
    if not try_acquire_lock("scheduler:check_selfsigned_renewals", ttl_seconds=600):
        logger.debug("check_selfsigned_renewals: skipped, another instance holds the lock")
        return
    try:
        _do_check_selfsigned_renewals()
    finally:
        release_lock("scheduler:check_selfsigned_renewals")


def _do_check_selfsigned_renewals():
    db = SessionLocal()
    try:
        global_threshold = settings.RENEWAL_THRESHOLD_DAYS
        now = datetime.now(timezone.utc)

        certs = (
            db.query(SelfSignedCertificate)
            .filter(
                SelfSignedCertificate.auto_renew.is_(True),
                SelfSignedCertificate.expires_at.isnot(None),
            )
            .all()
        )

        for cert in certs:
            threshold_days = cert.renewal_threshold_days if cert.renewal_threshold_days is not None else global_threshold
            threshold_dt = now + timedelta(days=threshold_days)
            if cert.expires_at <= threshold_dt:
                logger.info(
                    f"Self-signed certificate {cert.id} ({cert.common_name}) expiring at "
                    f"{cert.expires_at}, threshold {threshold_days}d, triggering renewal"
                )
                _auto_renew_selfsigned(db, cert)

    except Exception:
        logger.exception("Self-signed renewal check failed")
    finally:
        db.close()


def _auto_renew_selfsigned(db, cert):
    """Automatically renew a self-signed certificate."""
    import json
    from app.schemas.certificate import OidEntry
    from app.schemas.selfsigned import SelfSignedRequest
    from app.utils.crypto import encrypt

    try:
        san_list = json.loads(cert.san_domains) if cert.san_domains else None
        oid_list = [OidEntry(**o) for o in json.loads(cert.custom_oids)] if cert.custom_oids else None

        # Import locally to avoid circular imports
        from app.api.selfsigned import _generate_self_signed, _generate_ca_signed, _create_pending_deployments_self_signed

        req = SelfSignedRequest(
            common_name=cert.common_name,
            san_domains=san_list,
            organization=cert.organization,
            organizational_unit=cert.organizational_unit,
            country=cert.country,
            state=cert.state,
            locality=cert.locality,
            key_type=cert.key_type,
            key_size=cert.key_size,
            validity_days=cert.validity_days,
            is_ca=cert.is_ca,
            custom_oids=oid_list,
        )

        # If originally signed by a CA, re-sign with the same CA
        if cert.signed_by_ca_id:
            from app.utils.crypto import decrypt
            ca_record = db.query(SelfSignedCertificate).filter(
                SelfSignedCertificate.id == cert.signed_by_ca_id,
                SelfSignedCertificate.is_ca == True,  # noqa: E712
            ).first()
            if ca_record and ca_record.certificate_pem and ca_record.private_key_pem_encrypted:
                ca_key_pem = decrypt(ca_record.private_key_pem_encrypted)
                cert_pem, key_pem = _generate_ca_signed(req, ca_record.certificate_pem, ca_key_pem)
            else:
                logger.warning("CA %d no longer available for cert %d, skipping", cert.signed_by_ca_id, cert.id)
                return
        else:
            cert_pem, key_pem = _generate_self_signed(req)

        now = datetime.now(timezone.utc)
        cert.certificate_pem = cert_pem
        cert.private_key_pem_encrypted = encrypt(key_pem)
        cert.issued_at = now
        cert.expires_at = now + timedelta(days=cert.validity_days)
        cert.updated_at = now
        db.commit()
        db.refresh(cert)

        _create_pending_deployments_self_signed(db, cert.id)

        from app.services.email_service import notify_selfsigned_renewed
        from app.utils.time import format_now
        notify_selfsigned_renewed(
            group_id=cert.group_id,
            common_name=cert.common_name,
            renewed_by="System (auto-renewal)",
            renewed_at=format_now(),
            validity_days=cert.validity_days,
        )

        from app.services.notification_service import create_notification
        create_notification(
            group_id=cert.group_id,
            type="cert_renewed",
            resource_type="selfsigned",
            resource_id=cert.id,
            title=f"Self-signed renewed: {cert.common_name}",
            message=f"Self-signed certificate {cert.common_name} was automatically renewed.",
            actor="System (auto-renewal)",
            db=db,
        )

        logger.info(f"Self-signed certificate {cert.id} ({cert.common_name}) renewed successfully")
    except Exception:
        logger.exception(f"Failed to auto-renew self-signed certificate {cert.id} ({cert.common_name})")


def start_scheduler():
    global _scheduler
    _scheduler = BackgroundScheduler()
    _scheduler.add_job(
        check_renewals,
        "interval",
        hours=settings.RENEWAL_CHECK_HOURS,
        id="check_renewals",
    )
    _scheduler.add_job(
        check_selfsigned_renewals,
        "interval",
        hours=settings.RENEWAL_CHECK_HOURS,
        id="check_selfsigned_renewals",
    )
    _scheduler.add_job(
        check_expired,
        "interval",
        hours=1,
        id="check_expired",
    )
    _scheduler.start()
    logger.info("Scheduler started")


def stop_scheduler():
    global _scheduler
    if _scheduler:
        _scheduler.shutdown()
        logger.info("Scheduler stopped")
