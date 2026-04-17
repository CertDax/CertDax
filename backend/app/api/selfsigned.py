import io
import json
import zipfile
from datetime import datetime, timedelta, timezone

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from cryptography.x509.oid import NameOID, ExtendedKeyUsageOID
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, visible_group_ids
from app.database import get_db
from app.models.deployment import AgentCertificate, CertificateDeployment, DeploymentTarget
from app.models.selfsigned import SelfSignedCertificate
from app.models.user import User
from app.schemas.certificate import OidEntry
from app.schemas.selfsigned import (
    SelfSignedDetailResponse,
    SelfSignedRequest,
    SelfSignedResponse,
)
from app.utils.crypto import decrypt, encrypt

router = APIRouter()


def _get_username(db: Session, user_id: int | None) -> str | None:
    if not user_id:
        return None
    u = db.query(User).filter(User.id == user_id).first()
    return (u.display_name or u.username) if u else None


def _generate_self_signed(req: SelfSignedRequest) -> tuple[str, str]:
    """Generate a self-signed certificate and return (cert_pem, key_pem)."""
    # Generate private key
    if req.key_type == "ec":
        curve_map = {256: ec.SECP256R1(), 384: ec.SECP384R1()}
        curve = curve_map.get(req.key_size, ec.SECP256R1())
        private_key = ec.generate_private_key(curve)
        hash_alg = hashes.SHA256() if req.key_size <= 256 else hashes.SHA384()
    else:
        key_size = req.key_size if req.key_size in (2048, 4096) else 4096
        private_key = rsa.generate_private_key(public_exponent=65537, key_size=key_size)
        hash_alg = hashes.SHA256()

    # Build subject
    name_attrs = [x509.NameAttribute(NameOID.COMMON_NAME, req.common_name)]
    if req.organization:
        name_attrs.append(x509.NameAttribute(NameOID.ORGANIZATION_NAME, req.organization))
    if req.organizational_unit:
        name_attrs.append(x509.NameAttribute(NameOID.ORGANIZATIONAL_UNIT_NAME, req.organizational_unit))
    if req.country:
        name_attrs.append(x509.NameAttribute(NameOID.COUNTRY_NAME, req.country))
    if req.state:
        name_attrs.append(x509.NameAttribute(NameOID.STATE_OR_PROVINCE_NAME, req.state))
    if req.locality:
        name_attrs.append(x509.NameAttribute(NameOID.LOCALITY_NAME, req.locality))
    if req.custom_oids:
        for oid_entry in req.custom_oids:
            # EKU OIDs (1.3.6.1.5.5.7.3.*) must NOT be added to the Subject DN —
            # they belong in the ExtendedKeyUsage extension only.
            if oid_entry.oid.startswith("1.3.6.1.5.5.7.3."):
                continue
            oid_obj = x509.ObjectIdentifier(oid_entry.oid)
            name_attrs.append(x509.NameAttribute(oid_obj, oid_entry.value))

    subject = x509.Name(name_attrs)
    now = datetime.now(timezone.utc)
    not_after = now + timedelta(days=req.validity_days)

    builder = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(subject)  # self-signed: issuer = subject
        .public_key(private_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now)
        .not_valid_after(not_after)
    )

    # SANs
    all_domains = [req.common_name]
    if req.san_domains:
        for d in req.san_domains:
            d = d.strip()
            if d and d not in all_domains:
                all_domains.append(d)

    san_list = [x509.DNSName(d) for d in all_domains]
    builder = builder.add_extension(
        x509.SubjectAlternativeName(san_list), critical=False
    )

    # Basic Constraints
    builder = builder.add_extension(
        x509.BasicConstraints(ca=req.is_ca, path_length=0 if req.is_ca else None),
        critical=True,
    )

    # Key Usage
    if req.is_ca:
        builder = builder.add_extension(
            x509.KeyUsage(
                digital_signature=True,
                key_encipherment=False,
                content_commitment=False,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=True,
                crl_sign=True,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
    else:
        builder = builder.add_extension(
            x509.KeyUsage(
                digital_signature=True,
                key_encipherment=True,
                content_commitment=False,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=False,
                crl_sign=False,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
        eku_list = [
            ExtendedKeyUsageOID.SERVER_AUTH,
            ExtendedKeyUsageOID.CLIENT_AUTH,
        ]
        if req.custom_oids:
            for e in req.custom_oids:
                if e.oid.startswith("1.3.6.1.5.5.7.3.") or e.oid.startswith("1.3.6.1.4.1."):
                    oid = x509.ObjectIdentifier(e.oid)
                    if oid not in eku_list:
                        eku_list.append(oid)
        builder = builder.add_extension(
            x509.ExtendedKeyUsage(eku_list), critical=False,
        )

    # EKU for CA certificates.
    # CODE_SIGNING is only included when the user explicitly opts in (via custom_oids),
    # e.g. when this CA is used to sign certificates for the Windows Agent.
    if req.is_ca:
        ca_eku: list[x509.ObjectIdentifier] = [
            ExtendedKeyUsageOID.SERVER_AUTH,
            ExtendedKeyUsageOID.CLIENT_AUTH,
        ]
        if req.custom_oids:
            for e in req.custom_oids:
                if e.oid.startswith("1.3.6.1.5.5.7.3.") or e.oid.startswith("1.3.6.1.4.1."):
                    oid = x509.ObjectIdentifier(e.oid)
                    if oid not in ca_eku:
                        ca_eku.append(oid)
        builder = builder.add_extension(
            x509.ExtendedKeyUsage(ca_eku), critical=False,
        )

    # Subject Key Identifier
    builder = builder.add_extension(
        x509.SubjectKeyIdentifier.from_public_key(private_key.public_key()),
        critical=False,
    )

    # Authority Key Identifier (self-signed = same as subject key)
    builder = builder.add_extension(
        x509.AuthorityKeyIdentifier.from_issuer_public_key(private_key.public_key()),
        critical=False,
    )

    cert = builder.sign(private_key, hash_alg)

    cert_pem = cert.public_bytes(serialization.Encoding.PEM).decode()
    key_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode()

    return cert_pem, key_pem


def _generate_ca_signed(req: SelfSignedRequest, ca_cert_pem: str, ca_key_pem: str) -> tuple[str, str]:
    """Generate a certificate signed by a CA and return (cert_pem, key_pem)."""
    # Load CA certificate and key
    ca_cert = x509.load_pem_x509_certificate(ca_cert_pem.encode())
    ca_key = serialization.load_pem_private_key(ca_key_pem.encode(), password=None)

    # Determine hash algorithm based on CA key type
    if isinstance(ca_key, ec.EllipticCurvePrivateKey):
        hash_alg = hashes.SHA256() if ca_key.key_size <= 256 else hashes.SHA384()
    else:
        hash_alg = hashes.SHA256()

    # Generate private key for the new certificate
    if req.key_type == "ec":
        curve_map = {256: ec.SECP256R1(), 384: ec.SECP384R1()}
        curve = curve_map.get(req.key_size, ec.SECP256R1())
        private_key = ec.generate_private_key(curve)
    else:
        key_size = req.key_size if req.key_size in (2048, 4096) else 4096
        private_key = rsa.generate_private_key(public_exponent=65537, key_size=key_size)

    # Build subject
    name_attrs = [x509.NameAttribute(NameOID.COMMON_NAME, req.common_name)]
    if req.organization:
        name_attrs.append(x509.NameAttribute(NameOID.ORGANIZATION_NAME, req.organization))
    if req.organizational_unit:
        name_attrs.append(x509.NameAttribute(NameOID.ORGANIZATIONAL_UNIT_NAME, req.organizational_unit))
    if req.country:
        name_attrs.append(x509.NameAttribute(NameOID.COUNTRY_NAME, req.country))
    if req.state:
        name_attrs.append(x509.NameAttribute(NameOID.STATE_OR_PROVINCE_NAME, req.state))
    if req.locality:
        name_attrs.append(x509.NameAttribute(NameOID.LOCALITY_NAME, req.locality))
    if req.custom_oids:
        for oid_entry in req.custom_oids:
            # EKU OIDs (1.3.6.1.5.5.7.3.*) must NOT be added to the Subject DN —
            # they belong in the ExtendedKeyUsage extension only.
            if oid_entry.oid.startswith("1.3.6.1.5.5.7.3."):
                continue
            oid_obj = x509.ObjectIdentifier(oid_entry.oid)
            name_attrs.append(x509.NameAttribute(oid_obj, oid_entry.value))

    subject = x509.Name(name_attrs)
    now = datetime.now(timezone.utc)
    not_after = now + timedelta(days=req.validity_days)

    # Ensure certificate does not outlive the CA
    if not_after > ca_cert.not_valid_after_utc:
        not_after = ca_cert.not_valid_after_utc

    builder = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(ca_cert.subject)  # issuer = CA subject
        .public_key(private_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now)
        .not_valid_after(not_after)
    )

    # SANs
    all_domains = [req.common_name]
    if req.san_domains:
        for d in req.san_domains:
            d = d.strip()
            if d and d not in all_domains:
                all_domains.append(d)

    san_list = [x509.DNSName(d) for d in all_domains]
    builder = builder.add_extension(
        x509.SubjectAlternativeName(san_list), critical=False
    )

    # Basic Constraints
    builder = builder.add_extension(
        x509.BasicConstraints(ca=req.is_ca, path_length=0 if req.is_ca else None),
        critical=True,
    )

    # Key Usage
    if req.is_ca:
        builder = builder.add_extension(
            x509.KeyUsage(
                digital_signature=True,
                key_encipherment=False,
                content_commitment=False,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=True,
                crl_sign=True,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
    else:
        builder = builder.add_extension(
            x509.KeyUsage(
                digital_signature=True,
                key_encipherment=True,
                content_commitment=False,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=False,
                crl_sign=False,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
        eku_list = [
            ExtendedKeyUsageOID.SERVER_AUTH,
            ExtendedKeyUsageOID.CLIENT_AUTH,
        ]
        if req.custom_oids:
            for e in req.custom_oids:
                if e.oid.startswith("1.3.6.1.5.5.7.3.") or e.oid.startswith("1.3.6.1.4.1."):
                    oid = x509.ObjectIdentifier(e.oid)
                    if oid not in eku_list:
                        eku_list.append(oid)
        builder = builder.add_extension(
            x509.ExtendedKeyUsage(eku_list), critical=False,
        )

    # EKU for CA certificates — CODE_SIGNING only when explicitly requested via custom_oids.
    if req.is_ca:
        ca_eku_renew: list[x509.ObjectIdentifier] = [
            ExtendedKeyUsageOID.SERVER_AUTH,
            ExtendedKeyUsageOID.CLIENT_AUTH,
        ]
        if req.custom_oids:
            for e in req.custom_oids:
                if e.oid.startswith("1.3.6.1.5.5.7.3.") or e.oid.startswith("1.3.6.1.4.1."):
                    oid = x509.ObjectIdentifier(e.oid)
                    if oid not in ca_eku_renew:
                        ca_eku_renew.append(oid)
        builder = builder.add_extension(
            x509.ExtendedKeyUsage(ca_eku_renew), critical=False,
        )

    # Subject Key Identifier
    builder = builder.add_extension(
        x509.SubjectKeyIdentifier.from_public_key(private_key.public_key()),
        critical=False,
    )

    # Authority Key Identifier (from CA's public key)
    builder = builder.add_extension(
        x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_cert.public_key()),
        critical=False,
    )

    # Sign with the CA's private key
    cert = builder.sign(ca_key, hash_alg)

    cert_pem = cert.public_bytes(serialization.Encoding.PEM).decode()
    key_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode()

    return cert_pem, key_pem


@router.get("", response_model=list[SelfSignedResponse], summary="List self-signed certificates")
def list_self_signed(
    search: str | None = Query(None, description="Filter by common name (case-insensitive substring match)"),
    is_ca: bool | None = Query(None, description="Filter by CA status: true = only CAs, false = only non-CAs"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """List all self-signed certificates visible to the current user. Supports filtering by name and CA status."""
    query = db.query(SelfSignedCertificate).filter(SelfSignedCertificate.group_id.in_(visible_group_ids(db, user, "self_signed")))
    if search:
        query = query.filter(SelfSignedCertificate.common_name.ilike(f"%{search}%"))
    if is_ca is not None:
        query = query.filter(SelfSignedCertificate.is_ca == is_ca)
    certs = query.order_by(SelfSignedCertificate.created_at.desc()).all()
    result = []
    for cert in certs:
        resp = SelfSignedResponse.model_validate(cert)
        resp.created_by_username = _get_username(db, cert.created_by_user_id)
        resp.modified_by_username = _get_username(db, cert.modified_by_user_id)
        if cert.signed_by_ca_id:
            ca = db.query(SelfSignedCertificate).filter(SelfSignedCertificate.id == cert.signed_by_ca_id).first()
            resp.signed_by_ca_name = ca.common_name if ca else None
        result.append(resp)
    return result


@router.get("/{cert_id}", response_model=SelfSignedDetailResponse, summary="Get self-signed certificate details")
def get_self_signed(
    cert_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Get full details of a self-signed certificate including the PEM-encoded certificate."""
    cert = db.query(SelfSignedCertificate).filter(SelfSignedCertificate.id == cert_id, SelfSignedCertificate.group_id.in_(visible_group_ids(db, user, "self_signed"))).first()
    if not cert:
        raise HTTPException(status_code=404, detail="Certificate not found")
    resp = SelfSignedDetailResponse.model_validate(cert)
    resp.created_by_username = _get_username(db, cert.created_by_user_id)
    resp.modified_by_username = _get_username(db, cert.modified_by_user_id)
    if cert.signed_by_ca_id:
        ca = db.query(SelfSignedCertificate).filter(SelfSignedCertificate.id == cert.signed_by_ca_id).first()
        resp.signed_by_ca_name = ca.common_name if ca else None
    return resp


@router.post("", response_model=SelfSignedResponse, summary="Create a self-signed or CA-signed certificate")
def create_self_signed(
    req: SelfSignedRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Create a new certificate. By default it is self-signed. Set `is_ca: true` to create a
    CA certificate. Set `ca_id` to the ID of an existing CA certificate to create a certificate
    signed by that CA instead of self-signing it."""
    # Validate
    if not req.common_name.strip():
        raise HTTPException(status_code=400, detail="Common Name is required")
    if req.key_type not in ("rsa", "ec"):
        raise HTTPException(status_code=400, detail="Key type must be 'rsa' or 'ec'")
    if req.validity_days < 1 or req.validity_days > 3650:
        raise HTTPException(status_code=400, detail="Validity must be between 1 and 3650 days")

    # Determine if we're signing with a CA
    ca_record = None
    if req.ca_id:
        ca_record = db.query(SelfSignedCertificate).filter(
            SelfSignedCertificate.id == req.ca_id,
            SelfSignedCertificate.is_ca == True,  # noqa: E712
            SelfSignedCertificate.group_id.in_(visible_group_ids(db, user, "self_signed")),
        ).first()
        if not ca_record:
            raise HTTPException(status_code=404, detail="CA certificate not found")
        if not ca_record.certificate_pem or not ca_record.private_key_pem_encrypted:
            raise HTTPException(status_code=400, detail="CA certificate has no key material")

    # Generate
    if ca_record:
        ca_key_pem = decrypt(ca_record.private_key_pem_encrypted)
        cert_pem, key_pem = _generate_ca_signed(req, ca_record.certificate_pem, ca_key_pem)
    else:
        cert_pem, key_pem = _generate_self_signed(req)

    now = datetime.now(timezone.utc)
    san_json = json.dumps(req.san_domains) if req.san_domains else None

    record = SelfSignedCertificate(
        common_name=req.common_name.strip(),
        san_domains=san_json,
        organization=req.organization,
        organizational_unit=req.organizational_unit,
        country=req.country,
        state=req.state,
        locality=req.locality,
        key_type=req.key_type,
        key_size=req.key_size,
        validity_days=req.validity_days,
        is_ca=req.is_ca,
        signed_by_ca_id=req.ca_id,
        auto_renew=req.auto_renew,
        renewal_threshold_days=req.renewal_threshold_days,
        custom_oids=json.dumps([o.model_dump() for o in req.custom_oids]) if req.custom_oids else None,
        certificate_pem=cert_pem,
        private_key_pem_encrypted=encrypt(key_pem),
        issued_at=now,
        expires_at=now + timedelta(days=req.validity_days),
        group_id=user.group_id,
        created_by_user_id=user.id,
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    from app.services.email_service import notify_selfsigned_created
    from app.services.notification_service import create_notification
    from app.utils.time import format_now
    notify_selfsigned_created(
        group_id=user.group_id,
        common_name=record.common_name,
        created_by=user.display_name or user.username,
        created_at=format_now(),
    )
    create_notification(
        group_id=user.group_id,
        type="selfsigned_created",
        resource_type="self_signed",
        resource_id=record.id,
        title=f"Self-signed certificate created: {record.common_name}",
        message=f"Self-signed certificate {record.common_name} was created by {user.display_name or user.username}.",
        actor=user.display_name or user.username,
        db=db,
    )

    resp = SelfSignedResponse.model_validate(record)
    resp.created_by_username = user.display_name or user.username
    if ca_record:
        resp.signed_by_ca_name = ca_record.common_name
    return resp


@router.patch("/{cert_id}", response_model=SelfSignedResponse, summary="Update certificate settings")
def update_self_signed(
    cert_id: int,
    auto_renew: bool | None = Query(default=None),
    renewal_threshold_days: int | None = Query(default=None, ge=1, le=365),
    clear_threshold: bool = Query(default=False, description="Set renewal_threshold_days to null (use system default)"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Update mutable settings of an existing certificate (auto-renewal on/off, threshold)."""
    cert = db.query(SelfSignedCertificate).filter(
        SelfSignedCertificate.id == cert_id,
        SelfSignedCertificate.group_id.in_(visible_group_ids(db, user, "self_signed")),
    ).first()
    if not cert:
        raise HTTPException(status_code=404, detail="Certificate not found")

    if auto_renew is not None:
        cert.auto_renew = auto_renew
    if clear_threshold:
        cert.renewal_threshold_days = None
    elif renewal_threshold_days is not None:
        cert.renewal_threshold_days = renewal_threshold_days
    cert.modified_by_user_id = user.id
    cert.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(cert)

    resp = SelfSignedResponse.model_validate(cert)
    resp.created_by_username = _get_username(db, cert.created_by_user_id)
    resp.modified_by_username = _get_username(db, cert.modified_by_user_id)
    return resp


@router.delete("/{cert_id}", summary="Delete a self-signed certificate")
def delete_self_signed(
    cert_id: int,
    force: bool = Query(False, description="Force delete even if the certificate is still assigned to agents"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Delete a self-signed certificate. Returns 409 if it is still in use unless `force=true`."""
    cert = db.query(SelfSignedCertificate).filter(SelfSignedCertificate.id == cert_id, SelfSignedCertificate.group_id.in_(visible_group_ids(db, user, "self_signed"))).first()
    if not cert:
        raise HTTPException(status_code=404, detail="Certificate not found")
    common_name = cert.common_name
    group_id = cert.group_id

    # Check for active assignments and deployments
    assignments = (
        db.query(AgentCertificate)
        .join(DeploymentTarget, AgentCertificate.target_id == DeploymentTarget.id)
        .filter(AgentCertificate.self_signed_certificate_id == cert_id)
        .all()
    )
    active_deployments = (
        db.query(CertificateDeployment)
        .filter(
            CertificateDeployment.self_signed_certificate_id == cert_id,
            CertificateDeployment.status.in_(["deployed", "pending"]),
        )
        .count()
    )

    if (assignments or active_deployments) and not force:
        agent_names = []
        for a in assignments:
            target = db.query(DeploymentTarget).filter(DeploymentTarget.id == a.target_id).first()
            if target:
                agent_names.append(target.name)
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Certificate is still in use",
                "agents": agent_names,
                "deployment_count": active_deployments,
            },
        )

    # Mark deployed certs for removal on agents
    deployed = (
        db.query(CertificateDeployment)
        .filter(
            CertificateDeployment.self_signed_certificate_id == cert_id,
            CertificateDeployment.status.in_(["deployed", "failed"]),
        )
        .all()
    )
    for dep in deployed:
        dep.common_name = common_name
        dep.status = "pending_removal"
        dep.self_signed_certificate_id = None

    # Remove pending deployments that haven't been deployed yet
    db.query(CertificateDeployment).filter(
        CertificateDeployment.self_signed_certificate_id == cert_id,
        CertificateDeployment.status.in_(["pending"]),
    ).delete(synchronize_session="fetch")

    # Remove agent certificate assignments
    db.query(AgentCertificate).filter(
        AgentCertificate.self_signed_certificate_id == cert_id
    ).delete()

    db.delete(cert)
    db.commit()

    from app.services.email_service import notify_selfsigned_deleted
    from app.services.notification_service import create_notification
    from app.utils.time import format_now
    notify_selfsigned_deleted(
        group_id=group_id,
        common_name=common_name,
        deleted_by=user.display_name or user.username,
        deleted_at=format_now(),
    )
    create_notification(
        group_id=group_id,
        type="selfsigned_deleted",
        resource_type="self_signed",
        resource_id=cert_id,
        title=f"Self-signed certificate deleted: {common_name}",
        message=f"Self-signed certificate {common_name} was deleted by {user.display_name or user.username}.",
        actor=user.display_name or user.username,
    )

    return {"detail": "Certificate deleted"}


@router.post("/{cert_id}/renew", response_model=SelfSignedDetailResponse, summary="Renew a self-signed certificate")
def renew_self_signed(
    cert_id: int,
    validity_days: int | None = Query(None, ge=1, le=3650, description="Override validity period in days (defaults to original value)"),
    include_code_signing: bool = Query(default=False, description="Add Code Signing EKU (1.3.6.1.5.5.7.3.3) to the renewed CA certificate"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Renew a certificate by regenerating it with a new key pair. If the certificate was
    originally signed by a CA, it will be re-signed by the same CA. Triggers auto-deployment
    to all assigned agents."""
    cert = db.query(SelfSignedCertificate).filter(SelfSignedCertificate.id == cert_id, SelfSignedCertificate.group_id.in_(visible_group_ids(db, user, "self_signed"))).first()
    if not cert:
        raise HTTPException(status_code=404, detail="Certificate not found")

    effective_days = validity_days if validity_days is not None else cert.validity_days

    # Reconstruct the request from existing record
    san_list = json.loads(cert.san_domains) if cert.san_domains else None
    oid_list = [OidEntry(**o) for o in json.loads(cert.custom_oids)] if cert.custom_oids else []

    # Optionally add Code Signing EKU for CA certs
    CODE_SIGNING_OID = "1.3.6.1.5.5.7.3.3"
    if include_code_signing and cert.is_ca:
        if not any(o.oid == CODE_SIGNING_OID for o in oid_list):
            oid_list.append(OidEntry(oid=CODE_SIGNING_OID, value="codeSigning"))
        # Persist the updated OID list so future renewals keep it
        cert.custom_oids = json.dumps([o.model_dump() for o in oid_list])
    elif not include_code_signing and cert.is_ca:
        # Remove codeSigning if user explicitly opted out
        removed = [o for o in oid_list if o.oid != CODE_SIGNING_OID]
        if len(removed) != len(oid_list):
            oid_list = removed
            cert.custom_oids = json.dumps([o.model_dump() for o in oid_list]) if oid_list else None

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
        validity_days=effective_days,
        is_ca=cert.is_ca,
        custom_oids=oid_list if oid_list else None,
    )

    # If originally signed by a CA, re-sign with the same CA
    if cert.signed_by_ca_id:
        ca_record = db.query(SelfSignedCertificate).filter(
            SelfSignedCertificate.id == cert.signed_by_ca_id,
            SelfSignedCertificate.is_ca == True,  # noqa: E712
        ).first()
        if not ca_record or not ca_record.certificate_pem or not ca_record.private_key_pem_encrypted:
            raise HTTPException(status_code=400, detail="CA certificate no longer available for re-signing")
        ca_key_pem = decrypt(ca_record.private_key_pem_encrypted)
        cert_pem, key_pem = _generate_ca_signed(req, ca_record.certificate_pem, ca_key_pem)
    else:
        cert_pem, key_pem = _generate_self_signed(req)

    now = datetime.now(timezone.utc)
    cert.certificate_pem = cert_pem
    cert.private_key_pem_encrypted = encrypt(key_pem)
    cert.validity_days = effective_days
    cert.issued_at = now
    cert.expires_at = now + timedelta(days=effective_days)
    cert.updated_at = now
    cert.modified_by_user_id = user.id
    db.commit()
    db.refresh(cert)

    # Auto-deploy to all assigned agents
    _create_pending_deployments_self_signed(db, cert_id)

    from app.services.email_service import notify_selfsigned_renewed
    from app.services.notification_service import create_notification
    from app.utils.time import format_now
    notify_selfsigned_renewed(
        group_id=cert.group_id,
        common_name=cert.common_name,
        renewed_by=user.display_name or user.username,
        renewed_at=format_now(),
        validity_days=effective_days,
    )
    create_notification(
        group_id=cert.group_id,
        type="selfsigned_renewed",
        resource_type="self_signed",
        resource_id=cert.id,
        title=f"Self-signed certificate renewed: {cert.common_name}",
        message=f"Self-signed certificate {cert.common_name} was renewed by {user.display_name or user.username}.",
        actor=user.display_name or user.username,
        db=db,
    )

    resp = SelfSignedDetailResponse.model_validate(cert)
    resp.created_by_username = _get_username(db, cert.created_by_user_id)
    resp.modified_by_username = _get_username(db, cert.modified_by_user_id)
    return resp


def _create_pending_deployments_self_signed(db: Session, cert_id: int):
    """Replace old deployments and create new pending ones for all agents assigned to this self-signed cert."""
    # Remove old deployments for this cert so renewals replace them
    db.query(CertificateDeployment).filter(
        CertificateDeployment.self_signed_certificate_id == cert_id,
    ).delete()

    assignments = (
        db.query(AgentCertificate)
        .filter(
            AgentCertificate.self_signed_certificate_id == cert_id,
            AgentCertificate.auto_deploy == True,  # noqa: E712
        )
        .all()
    )
    for ac in assignments:
        dep = CertificateDeployment(
            self_signed_certificate_id=cert_id,
            target_id=ac.target_id,
            status="pending",
            deploy_format=ac.deploy_format,
        )
        db.add(dep)
    db.commit()


@router.get("/{cert_id}/parsed")
def get_self_signed_parsed(
    cert_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Returns parsed X.509 details for the self-signed certificate."""
    cert = db.query(SelfSignedCertificate).filter(SelfSignedCertificate.id == cert_id, SelfSignedCertificate.group_id.in_(visible_group_ids(db, user, "self_signed"))).first()
    if not cert:
        raise HTTPException(status_code=404, detail="Certificate not found")
    if not cert.certificate_pem:
        raise HTTPException(status_code=400, detail="Certificate is not available")

    from app.api.certificates import _parse_x509_details
    return {"certificate": _parse_x509_details(cert.certificate_pem)}


@router.get("/{cert_id}/download/zip", summary="Download certificate as ZIP")
def download_self_signed_zip(
    cert_id: int,
    password: str | None = Query(None, description="Optional password to encrypt the private key"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Download the certificate and private key as a ZIP archive. For CA-signed certificates,
    the ZIP also includes the CA certificate and a full-chain file."""
    cert = db.query(SelfSignedCertificate).filter(SelfSignedCertificate.id == cert_id, SelfSignedCertificate.group_id.in_(visible_group_ids(db, user, "self_signed"))).first()
    if not cert or not cert.certificate_pem:
        raise HTTPException(status_code=404, detail="Certificate not found")

    key_pem = decrypt(cert.private_key_pem_encrypted)
    if password:
        from cryptography.hazmat.primitives.serialization import BestAvailableEncryption
        key_obj = serialization.load_pem_private_key(key_pem.encode(), password=None)
        key_pem = key_obj.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=BestAvailableEncryption(password.encode()),
        ).decode()

    safe_name = cert.common_name.replace("*", "wildcard").replace("/", "_").replace(" ", "_")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(f"{safe_name}.crt", cert.certificate_pem)
        zf.writestr(f"{safe_name}.key", key_pem)
        # Include CA chain if signed by a CA
        if cert.signed_by_ca_id:
            ca = db.query(SelfSignedCertificate).filter(SelfSignedCertificate.id == cert.signed_by_ca_id).first()
            if ca and ca.certificate_pem:
                zf.writestr(f"{safe_name}-ca.crt", ca.certificate_pem)
                zf.writestr(f"{safe_name}-fullchain.crt", cert.certificate_pem + ca.certificate_pem)

    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}.zip"'},
    )


@router.get("/{cert_id}/download/pem/{file_type}", summary="Download certificate component as PEM")
def download_self_signed_pem(
    cert_id: int,
    file_type: str,
    password: str | None = Query(None, description="Optional password to encrypt the private key"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    cert = db.query(SelfSignedCertificate).filter(SelfSignedCertificate.id == cert_id, SelfSignedCertificate.group_id.in_(visible_group_ids(db, user, "self_signed"))).first()
    if not cert or not cert.certificate_pem:
        raise HTTPException(status_code=404, detail="Certificate not found")

    safe_name = cert.common_name.replace("*", "wildcard").replace("/", "_").replace(" ", "_")

    if file_type == "certificate":
        content = cert.certificate_pem
        filename = f"{safe_name}.crt"
    elif file_type == "privatekey":
        content = decrypt(cert.private_key_pem_encrypted)
        if password:
            from cryptography.hazmat.primitives.serialization import BestAvailableEncryption
            key_obj = serialization.load_pem_private_key(content.encode(), password=None)
            content = key_obj.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.PKCS8,
                encryption_algorithm=BestAvailableEncryption(password.encode()),
            ).decode()
        filename = f"{safe_name}.key"
    elif file_type == "combined":
        key_pem = decrypt(cert.private_key_pem_encrypted)
        content = key_pem + "\n" + cert.certificate_pem
        filename = f"{safe_name}-combined.pem"
    elif file_type == "chain":
        if not cert.signed_by_ca_id:
            raise HTTPException(status_code=400, detail="Certificate is not CA-signed")
        ca = db.query(SelfSignedCertificate).filter(SelfSignedCertificate.id == cert.signed_by_ca_id).first()
        if not ca or not ca.certificate_pem:
            raise HTTPException(status_code=400, detail="CA certificate not available")
        content = cert.certificate_pem + ca.certificate_pem
        filename = f"{safe_name}-fullchain.crt"
    elif file_type == "ca":
        if not cert.signed_by_ca_id:
            raise HTTPException(status_code=400, detail="Certificate is not CA-signed")
        ca = db.query(SelfSignedCertificate).filter(SelfSignedCertificate.id == cert.signed_by_ca_id).first()
        if not ca or not ca.certificate_pem:
            raise HTTPException(status_code=400, detail="CA certificate not available")
        content = ca.certificate_pem
        filename = f"{safe_name}-ca.crt"
    else:
        raise HTTPException(status_code=400, detail="Invalid file type")

    return StreamingResponse(
        io.BytesIO(content.encode()),
        media_type="application/x-pem-file",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{cert_id}/download/pfx", summary="Download certificate as PFX/PKCS#12")
def download_self_signed_pfx(
    cert_id: int,
    password: str | None = Query(None, description="Optional password to encrypt the PFX file"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Download the certificate as a PFX/PKCS#12 file for Windows Server / IIS.
    For CA-signed certificates, the CA chain is included in the PFX."""
    from cryptography.hazmat.primitives.serialization import pkcs12

    cert = db.query(SelfSignedCertificate).filter(SelfSignedCertificate.id == cert_id, SelfSignedCertificate.group_id.in_(visible_group_ids(db, user, "self_signed"))).first()
    if not cert or not cert.certificate_pem:
        raise HTTPException(status_code=404, detail="Certificate not found")

    key_pem = decrypt(cert.private_key_pem_encrypted)
    key_obj = serialization.load_pem_private_key(key_pem.encode(), password=None)
    cert_obj = x509.load_pem_x509_certificate(cert.certificate_pem.encode())

    # Include CA chain if signed by a CA
    ca_certs = None
    if cert.signed_by_ca_id:
        ca = db.query(SelfSignedCertificate).filter(SelfSignedCertificate.id == cert.signed_by_ca_id).first()
        if ca and ca.certificate_pem:
            ca_certs = [x509.load_pem_x509_certificate(ca.certificate_pem.encode())]

    pfx_password = password.encode() if password else None
    pfx_data = pkcs12.serialize_key_and_certificates(
        name=cert.common_name.encode(),
        key=key_obj,
        cert=cert_obj,
        cas=ca_certs,
        encryption_algorithm=(
            serialization.BestAvailableEncryption(pfx_password)
            if pfx_password
            else serialization.NoEncryption()
        ),
    )

    safe_name = cert.common_name.replace("*", "wildcard").replace("/", "_").replace(" ", "_")
    return StreamingResponse(
        io.BytesIO(pfx_data),
        media_type="application/x-pkcs12",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}.pfx"'},
    )
