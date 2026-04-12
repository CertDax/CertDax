import logging

from app.database import SessionLocal
from app.models.certificate import CertificateAuthority
from app.models.group import Group

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
        default_group = db.query(Group).first()
        group_id = default_group.id if default_group else None

        for ca_data in DEFAULT_CAS:
            existing = (
                db.query(CertificateAuthority)
                .filter(CertificateAuthority.directory_url == ca_data["directory_url"])
                .first()
            )
            if not existing:
                ca = CertificateAuthority(**ca_data, group_id=group_id)
                db.add(ca)
                logger.info(f"Seeded CA: {ca_data['name']}")
            elif existing.group_id is None and group_id:
                existing.group_id = group_id
        db.commit()
    finally:
        db.close()
