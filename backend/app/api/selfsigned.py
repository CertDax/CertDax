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
        builder = builder.add_extension(
            x509.ExtendedKeyUsage([
                ExtendedKeyUsageOID.SERVER_AUTH,
                ExtendedKeyUsageOID.CLIENT_AUTH,
            ]),
            critical=False,
        )

    # Custom EKU OIDs
    if req.custom_oids:
        eku_oids = [
            e for e in req.custom_oids
            if e.oid.startswith("1.3.6.1.5.5.7.3.")
            or e.oid.startswith("1.3.6.1.4.1.")
        ]
        if eku_oids:
            eku_list = [x509.ObjectIdentifier(e.oid) for e in eku_oids]
            builder = builder.add_extension(
                x509.ExtendedKeyUsage(eku_list), critical=False,
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


@router.get("", response_model=list[SelfSignedResponse])
def list_self_signed(
    search: str | None = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    query = db.query(SelfSignedCertificate).filter(SelfSignedCertificate.group_id.in_(visible_group_ids(db, user, "self_signed")))
    if search:
        query = query.filter(SelfSignedCertificate.common_name.ilike(f"%{search}%"))
    certs = query.order_by(SelfSignedCertificate.created_at.desc()).all()
    result = []
    for cert in certs:
        resp = SelfSignedResponse.model_validate(cert)
        resp.created_by_username = _get_username(db, cert.created_by_user_id)
        resp.modified_by_username = _get_username(db, cert.modified_by_user_id)
        result.append(resp)
    return result


@router.get("/{cert_id}", response_model=SelfSignedDetailResponse)
def get_self_signed(
    cert_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    cert = db.query(SelfSignedCertificate).filter(SelfSignedCertificate.id == cert_id, SelfSignedCertificate.group_id.in_(visible_group_ids(db, user, "self_signed"))).first()
    if not cert:
        raise HTTPException(status_code=404, detail="Certificate not found")
    resp = SelfSignedDetailResponse.model_validate(cert)
    resp.created_by_username = _get_username(db, cert.created_by_user_id)
    resp.modified_by_username = _get_username(db, cert.modified_by_user_id)
    return resp


@router.post("", response_model=SelfSignedResponse)
def create_self_signed(
    req: SelfSignedRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    # Validate
    if not req.common_name.strip():
        raise HTTPException(status_code=400, detail="Common Name is required")
    if req.key_type not in ("rsa", "ec"):
        raise HTTPException(status_code=400, detail="Key type must be 'rsa' or 'ec'")
    if req.validity_days < 1 or req.validity_days > 3650:
        raise HTTPException(status_code=400, detail="Validity must be between 1 and 3650 days")

    # Generate
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
    from app.utils.time import format_now
    notify_selfsigned_created(
        group_id=user.group_id,
        common_name=record.common_name,
        created_by=user.display_name or user.username,
        created_at=format_now(),
    )

    resp = SelfSignedResponse.model_validate(record)
    resp.created_by_username = user.display_name or user.username
    return resp


@router.delete("/{cert_id}")
def delete_self_signed(
    cert_id: int,
    force: bool = Query(False),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
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
    from app.utils.time import format_now
    notify_selfsigned_deleted(
        group_id=group_id,
        common_name=common_name,
        deleted_by=user.display_name or user.username,
        deleted_at=format_now(),
    )

    return {"detail": "Certificate deleted"}


@router.post("/{cert_id}/renew", response_model=SelfSignedDetailResponse)
def renew_self_signed(
    cert_id: int,
    validity_days: int | None = Query(None, ge=1, le=3650),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    cert = db.query(SelfSignedCertificate).filter(SelfSignedCertificate.id == cert_id, SelfSignedCertificate.group_id.in_(visible_group_ids(db, user, "self_signed"))).first()
    if not cert:
        raise HTTPException(status_code=404, detail="Certificate not found")

    effective_days = validity_days if validity_days is not None else cert.validity_days

    # Reconstruct the request from existing record
    san_list = json.loads(cert.san_domains) if cert.san_domains else None
    oid_list = [OidEntry(**o) for o in json.loads(cert.custom_oids)] if cert.custom_oids else None
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
        custom_oids=oid_list,
    )

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
    from app.utils.time import format_now
    notify_selfsigned_renewed(
        group_id=cert.group_id,
        common_name=cert.common_name,
        renewed_by=user.display_name or user.username,
        renewed_at=format_now(),
        validity_days=effective_days,
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


@router.get("/{cert_id}/download/zip")
def download_self_signed_zip(
    cert_id: int,
    password: str | None = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
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

    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}.zip"'},
    )


@router.get("/{cert_id}/download/pem/{file_type}")
def download_self_signed_pem(
    cert_id: int,
    file_type: str,
    password: str | None = Query(None),
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
    else:
        raise HTTPException(status_code=400, detail="Invalid file type")

    return StreamingResponse(
        io.BytesIO(content.encode()),
        media_type="application/x-pem-file",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{cert_id}/download/pfx")
def download_self_signed_pfx(
    cert_id: int,
    password: str | None = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from cryptography.hazmat.primitives.serialization import pkcs12

    cert = db.query(SelfSignedCertificate).filter(SelfSignedCertificate.id == cert_id, SelfSignedCertificate.group_id.in_(visible_group_ids(db, user, "self_signed"))).first()
    if not cert or not cert.certificate_pem:
        raise HTTPException(status_code=404, detail="Certificate not found")

    key_pem = decrypt(cert.private_key_pem_encrypted)
    key_obj = serialization.load_pem_private_key(key_pem.encode(), password=None)
    cert_obj = x509.load_pem_x509_certificate(cert.certificate_pem.encode())

    pfx_password = password.encode() if password else None
    pfx_data = pkcs12.serialize_key_and_certificates(
        name=cert.common_name.encode(),
        key=key_obj,
        cert=cert_obj,
        cas=None,
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
