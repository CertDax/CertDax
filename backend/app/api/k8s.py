"""Kubernetes operator API endpoints.

These endpoints allow the CertDax Kubernetes operator to fetch certificate
material (PEM + private key) so it can create TLS secrets in the cluster.
Authentication is via the standard API key / JWT mechanism.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, visible_group_ids
from app.database import get_db
from app.models.certificate import Certificate
from app.models.selfsigned import SelfSignedCertificate
from app.models.user import User
from app.utils.crypto import decrypt

router = APIRouter()


@router.get("/certificate/selfsigned/{cert_id}", summary="Fetch self-signed certificate for K8s")
def get_selfsigned_certificate(
    cert_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Return the PEM-encoded certificate, private key and metadata so the
    Kubernetes operator can create a TLS secret."""
    cert = (
        db.query(SelfSignedCertificate)
        .filter(
            SelfSignedCertificate.id == cert_id,
            SelfSignedCertificate.group_id.in_(
                visible_group_ids(db, user, "self_signed")
            ),
        )
        .first()
    )
    if not cert:
        raise HTTPException(status_code=404, detail="Certificate not found")
    if not cert.certificate_pem or not cert.private_key_pem_encrypted:
        raise HTTPException(status_code=400, detail="Certificate has no key material")

    key_pem = decrypt(cert.private_key_pem_encrypted)

    # Build CA chain if CA-signed
    chain_pem = None
    if cert.signed_by_ca_id:
        ca = (
            db.query(SelfSignedCertificate)
            .filter(SelfSignedCertificate.id == cert.signed_by_ca_id)
            .first()
        )
        if ca and ca.certificate_pem:
            chain_pem = ca.certificate_pem

    return {
        "id": cert.id,
        "common_name": cert.common_name,
        "certificate_pem": cert.certificate_pem,
        "private_key_pem": key_pem,
        "chain_pem": chain_pem,
        "is_ca": cert.is_ca,
        "issued_at": cert.issued_at.isoformat() if cert.issued_at else None,
        "expires_at": cert.expires_at.isoformat() if cert.expires_at else None,
    }


@router.get("/certificate/acme/{cert_id}", summary="Fetch ACME certificate for K8s")
def get_acme_certificate(
    cert_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Return the PEM-encoded ACME certificate, private key and chain so the
    Kubernetes operator can create a TLS secret."""
    cert = (
        db.query(Certificate)
        .filter(
            Certificate.id == cert_id,
            Certificate.group_id.in_(
                visible_group_ids(db, user, "certificates")
            ),
        )
        .first()
    )
    if not cert:
        raise HTTPException(status_code=404, detail="Certificate not found")
    if not cert.certificate_pem or not cert.private_key_pem_encrypted:
        raise HTTPException(status_code=400, detail="Certificate has no key material")
    if cert.status not in ("valid", "issued"):
        raise HTTPException(status_code=400, detail="Certificate is not yet issued")

    key_pem = decrypt(cert.private_key_pem_encrypted)

    return {
        "id": cert.id,
        "common_name": cert.common_name,
        "certificate_pem": cert.certificate_pem,
        "private_key_pem": key_pem,
        "chain_pem": cert.chain_pem,
        "issued_at": cert.issued_at.isoformat() if cert.issued_at else None,
        "expires_at": cert.expires_at.isoformat() if cert.expires_at else None,
    }
