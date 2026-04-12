import logging
from datetime import datetime, timedelta, timezone

from apscheduler.schedulers.background import BackgroundScheduler

from app.config import settings
from app.database import SessionLocal
from app.models.certificate import Certificate
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
        threshold = datetime.now(timezone.utc) + timedelta(
            days=settings.RENEWAL_THRESHOLD_DAYS
        )
        certs = (
            db.query(Certificate)
            .filter(
                Certificate.auto_renew.is_(True),
                Certificate.status == "valid",
                Certificate.expires_at <= threshold,
            )
            .all()
        )

        for cert in certs:
            logger.info(
                f"Certificate {cert.id} ({cert.common_name}) expiring at "
                f"{cert.expires_at}, triggering renewal"
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
        db.commit()
    except Exception:
        logger.exception("Expired check failed")
    finally:
        db.close()


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
