"""Kubernetes operator API endpoints.

These endpoints allow the CertDax Kubernetes operator to fetch certificate
material (PEM + private key) so it can create TLS secrets in the cluster.
Authentication is via the standard API key / JWT mechanism.
"""

import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
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
    if cert.status not in ("valid", "issued"):
        raise HTTPException(status_code=400, detail="Certificate is not yet issued")
    if not cert.certificate_pem or not cert.private_key_pem_encrypted:
        raise HTTPException(status_code=400, detail="Certificate has no key material")

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


# --- Certificate request endpoint (operator creates certs via YAML) ---


class K8sCertificateRequestBody(BaseModel):
    common_name: str
    san_domains: str | None = None
    type: str = "selfsigned"  # "selfsigned" or "acme"
    provider_id: int | None = None
    dns_provider_id: int | None = None
    ca_id: int | None = None
    is_ca: bool = False
    auto_renew: bool = True
    validity_days: int = 365


@router.post("/certificates/request", summary="Request a new certificate from the K8s operator")
def request_certificate_from_operator(
    body: K8sCertificateRequestBody,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Called by the K8s operator when a CertDaxCertificate CR has a request
    block but no certificateId yet.  Creates the cert in CertDax and returns
    the new certificate ID."""

    if body.type == "acme":
        # --- ACME certificate request ---
        if not body.provider_id:
            raise HTTPException(status_code=400, detail="providerId is required for ACME certificates")

        from app.models.certificate import CertificateAuthority
        from app.services.certificate_service import trigger_certificate_request

        ca = db.query(CertificateAuthority).filter(
            CertificateAuthority.id == body.provider_id,
        ).first()
        if not ca:
            raise HTTPException(status_code=404, detail="ACME provider (CA) not found")

        # Duplicate prevention: reuse an existing ACME cert with the same
        # common_name and CA in the same group if it is still valid.
        from datetime import datetime, timezone
        existing = db.query(Certificate).filter(
            Certificate.common_name == body.common_name,
            Certificate.ca_id == body.provider_id,
            Certificate.group_id == user.group_id,
            Certificate.status.in_(["issued", "pending"]),
        ).first()
        if existing:
            return {"id": existing.id, "type": "acme", "status": existing.status}

        domains = [body.common_name]
        if body.san_domains:
            domains += [d.strip() for d in body.san_domains.split(",") if d.strip()]

        san_json = json.dumps(domains) if len(domains) > 1 else None

        new_cert = Certificate(
            common_name=body.common_name,
            san_domains=san_json,
            ca_id=body.provider_id,
            dns_provider_id=body.dns_provider_id,
            challenge_type="dns-01",
            auto_renew=body.auto_renew,
            status="pending",
            group_id=user.group_id,
            created_by_user_id=user.id,
        )
        db.add(new_cert)
        db.commit()
        db.refresh(new_cert)

        trigger_certificate_request(new_cert.id)

        from app.services.email_service import notify_certificate_requested
        from app.utils.time import format_now
        notify_certificate_requested(
            group_id=user.group_id,
            common_name=new_cert.common_name,
            requested_by=user.display_name or user.username,
            requested_at=format_now(),
        )

        return {"id": new_cert.id, "type": "acme", "status": "pending"}

    else:
        # --- Self-signed / CA-signed certificate request ---
        from app.api.selfsigned import _generate_self_signed, _generate_ca_signed
        from app.utils.crypto import encrypt
        from app.schemas.selfsigned import SelfSignedRequest
        from datetime import datetime, timezone, timedelta

        # Duplicate prevention: check if a self-signed cert with the same
        # common_name, is_ca, and ca_id already exists in the same group.
        existing = db.query(SelfSignedCertificate).filter(
            SelfSignedCertificate.common_name == body.common_name,
            SelfSignedCertificate.is_ca == body.is_ca,
            SelfSignedCertificate.signed_by_ca_id == body.ca_id,
            SelfSignedCertificate.group_id.in_(visible_group_ids(db, user, "self_signed")),
        ).first()
        if existing:
            return {"id": existing.id, "type": "selfsigned", "status": "issued"}

        san_list = None
        if body.san_domains:
            san_list = [d.strip() for d in body.san_domains.split(",") if d.strip()]

        req = SelfSignedRequest(
            common_name=body.common_name,
            san_domains=san_list,
            validity_days=body.validity_days,
            auto_renew=body.auto_renew,
            ca_id=body.ca_id,
            is_ca=body.is_ca,
        )

        ca_record = None
        if body.ca_id:
            ca_record = db.query(SelfSignedCertificate).filter(
                SelfSignedCertificate.id == body.ca_id,
                SelfSignedCertificate.is_ca == True,  # noqa: E712
                SelfSignedCertificate.group_id.in_(visible_group_ids(db, user, "self_signed")),
            ).first()
            if not ca_record:
                raise HTTPException(status_code=404, detail="CA certificate not found")
            ca_key_pem = decrypt(ca_record.private_key_pem_encrypted)
            cert_pem, key_pem = _generate_ca_signed(req, ca_record.certificate_pem, ca_key_pem)
        else:
            cert_pem, key_pem = _generate_self_signed(req)

        now = datetime.now(timezone.utc)
        expires = now + timedelta(days=body.validity_days)

        san_json = json.dumps(san_list) if san_list else None

        new_cert = SelfSignedCertificate(
            common_name=body.common_name,
            san_domains=san_json,
            key_type="rsa",
            key_size=4096,
            validity_days=body.validity_days,
            is_ca=body.is_ca,
            signed_by_ca_id=body.ca_id,
            auto_renew=body.auto_renew,
            certificate_pem=cert_pem,
            private_key_pem_encrypted=encrypt(key_pem),
            issued_at=now,
            expires_at=expires,
            group_id=user.group_id,
            created_by_user_id=user.id,
        )
        db.add(new_cert)
        db.commit()
        db.refresh(new_cert)

        from app.services.email_service import notify_selfsigned_created
        from app.utils.time import format_now
        notify_selfsigned_created(
            group_id=user.group_id,
            common_name=new_cert.common_name,
            created_by=user.display_name or user.username,
            created_at=format_now(),
        )

        return {"id": new_cert.id, "type": "selfsigned", "status": "issued"}
