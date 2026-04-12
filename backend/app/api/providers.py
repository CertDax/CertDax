import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, visible_group_ids
from app.database import get_db
from app.models.certificate import CertificateAuthority
from app.models.provider import DnsProvider
from app.models.user import User
from app.schemas.provider import (
    CertificateAuthorityCreate,
    CertificateAuthorityResponse,
    DnsProviderCreate,
    DnsProviderResponse,
    DnsProviderUpdate,
)
from app.utils.crypto import encrypt

router = APIRouter()


# Certificate Authorities

@router.get("/cas", response_model=list[CertificateAuthorityResponse])
def list_cas(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    cas = db.query(CertificateAuthority).filter(
        or_(
            CertificateAuthority.group_id.in_(visible_group_ids(db, user, "providers")),
            CertificateAuthority.group_id.is_(None),
        ),
        CertificateAuthority.is_active == True,
    ).order_by(CertificateAuthority.name).all()
    result = []
    for ca in cas:
        resp = CertificateAuthorityResponse.model_validate(ca)
        resp.has_account = ca.account_url is not None
        resp.has_eab = ca.eab_kid is not None
        result.append(resp)
    return result


@router.post("/cas", response_model=CertificateAuthorityResponse)
def create_ca(
    req: CertificateAuthorityCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    existing = (
        db.query(CertificateAuthority)
        .filter(CertificateAuthority.directory_url == req.directory_url)
        .first()
    )
    if existing:
        raise HTTPException(status_code=400, detail="CA with this URL already exists")

    ca = CertificateAuthority(
        name=req.name,
        directory_url=req.directory_url,
        is_staging=req.is_staging,
        contact_email=req.contact_email,
        eab_kid=encrypt(req.eab_kid) if req.eab_kid else None,
        eab_hmac_key=encrypt(req.eab_hmac_key) if req.eab_hmac_key else None,
        group_id=user.group_id,
    )
    db.add(ca)
    db.commit()
    db.refresh(ca)
    resp = CertificateAuthorityResponse.model_validate(ca)
    resp.has_eab = ca.eab_kid is not None
    return resp


@router.put("/cas/{ca_id}", response_model=CertificateAuthorityResponse)
def update_ca(
    ca_id: int,
    req: CertificateAuthorityCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ca = (
        db.query(CertificateAuthority)
        .filter(
            CertificateAuthority.id == ca_id,
            or_(
                CertificateAuthority.group_id.in_(visible_group_ids(db, user, "providers")),
                CertificateAuthority.group_id.is_(None),
            ),
        )
        .first()
    )
    if not ca:
        raise HTTPException(status_code=404, detail="CA not found")

    ca.name = req.name
    ca.directory_url = req.directory_url
    ca.is_staging = req.is_staging
    ca.contact_email = req.contact_email
    if req.eab_kid:
        ca.eab_kid = encrypt(req.eab_kid)
    if req.eab_hmac_key:
        ca.eab_hmac_key = encrypt(req.eab_hmac_key)
    db.commit()
    db.refresh(ca)

    resp = CertificateAuthorityResponse.model_validate(ca)
    resp.has_account = ca.account_url is not None
    resp.has_eab = ca.eab_kid is not None
    return resp


# DNS Providers

@router.get("/dns", response_model=list[DnsProviderResponse])
def list_dns_providers(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    providers = db.query(DnsProvider).filter(DnsProvider.group_id.in_(visible_group_ids(db, user, "providers"))).order_by(DnsProvider.name).all()
    return [DnsProviderResponse.model_validate(p) for p in providers]


@router.post("/dns", response_model=DnsProviderResponse)
def create_dns_provider(
    req: DnsProviderCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    encrypted_creds = encrypt(json.dumps(req.credentials)) if req.credentials else None

    provider = DnsProvider(
        name=req.name,
        provider_type=req.provider_type,
        credentials_encrypted=encrypted_creds,
        group_id=user.group_id,
    )
    db.add(provider)
    db.commit()
    db.refresh(provider)
    return DnsProviderResponse.model_validate(provider)


@router.put("/dns/{provider_id}", response_model=DnsProviderResponse)
def update_dns_provider(
    provider_id: int,
    req: DnsProviderUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    provider = db.query(DnsProvider).filter(DnsProvider.id == provider_id, DnsProvider.group_id.in_(visible_group_ids(db, user, "providers"))).first()
    if not provider:
        raise HTTPException(status_code=404, detail="DNS provider not found")

    if req.name is not None:
        provider.name = req.name
    if req.credentials is not None:
        provider.credentials_encrypted = encrypt(json.dumps(req.credentials))
    if req.is_active is not None:
        provider.is_active = req.is_active

    db.commit()
    db.refresh(provider)
    return DnsProviderResponse.model_validate(provider)


@router.delete("/dns/{provider_id}")
def delete_dns_provider(
    provider_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    provider = db.query(DnsProvider).filter(DnsProvider.id == provider_id, DnsProvider.group_id.in_(visible_group_ids(db, user, "providers"))).first()
    if not provider:
        raise HTTPException(status_code=404, detail="DNS provider not found")

    db.delete(provider)
    db.commit()
    return {"detail": "DNS provider deleted"}
