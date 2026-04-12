import logging

from app.database import SessionLocal
from app.models.certificate import CertificateAuthority

logger = logging.getLogger(__name__)

DEFAULT_CAS = [
    {
        "name": "Let's Encrypt",
        "directory_url": "https://acme-v02.api.letsencrypt.org/directory",
        "is_staging": False,
    },
    {
        "name": "Let's Encrypt (Staging)",
        "directory_url": "https://acme-staging-v02.api.letsencrypt.org/directory",
        "is_staging": True,
    },
]


def seed_default_cas():
    db = SessionLocal()
    try:
        for ca_data in DEFAULT_CAS:
            existing = (
                db.query(CertificateAuthority)
                .filter(CertificateAuthority.directory_url == ca_data["directory_url"])
                .first()
            )
            if not existing:
                ca = CertificateAuthority(**ca_data, group_id=None)
                db.add(ca)
                logger.info(f"Seeded CA: {ca_data['name']}")
            elif existing.group_id is not None:
                # Migrate existing seed CAs to global (group_id=NULL)
                existing.group_id = None
                logger.info(f"Migrated CA to global: {ca_data['name']}")
        db.commit()
    finally:
        db.close()
