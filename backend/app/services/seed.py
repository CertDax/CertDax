import logging

from app.database import SessionLocal
from app.models.ca_group_account import CaGroupAccount
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
                # Migrate existing seed CAs to global — move account data to group override
                old_group_id = existing.group_id
                if existing.contact_email or existing.account_key_pem or existing.account_url:
                    override = db.query(CaGroupAccount).filter(
                        CaGroupAccount.ca_id == existing.id,
                        CaGroupAccount.group_id == old_group_id,
                    ).first()
                    if not override:
                        override = CaGroupAccount(
                            ca_id=existing.id,
                            group_id=old_group_id,
                            contact_email=existing.contact_email,
                            account_key_pem=existing.account_key_pem,
                            account_url=existing.account_url,
                        )
                        db.add(override)
                        logger.info(f"Migrated account data for CA '{ca_data['name']}' to group {old_group_id}")
                    existing.contact_email = None
                    existing.account_key_pem = None
                    existing.account_url = None
                existing.group_id = None
                logger.info(f"Migrated CA to global: {ca_data['name']}")
            elif existing.contact_email or existing.account_key_pem or existing.account_url:
                # Already global but has leftover shared account data — move to Default group (1)
                override = db.query(CaGroupAccount).filter(
                    CaGroupAccount.ca_id == existing.id,
                    CaGroupAccount.group_id == 1,
                ).first()
                if not override:
                    override = CaGroupAccount(
                        ca_id=existing.id,
                        group_id=1,
                        contact_email=existing.contact_email,
                        account_key_pem=existing.account_key_pem,
                        account_url=existing.account_url,
                    )
                    db.add(override)
                    logger.info(f"Migrated leftover account data for global CA '{ca_data['name']}' to group 1")
                existing.contact_email = None
                existing.account_key_pem = None
                existing.account_url = None
        db.commit()
    finally:
        db.close()
