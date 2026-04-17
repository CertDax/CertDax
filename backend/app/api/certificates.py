import io
import json
import zipfile
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, visible_group_ids
from app.database import get_db
from app.models.ca_group_account import CaGroupAccount
from app.models.certificate import Certificate, CertificateAuthority
from app.models.deployment import CertificateDeployment, DeploymentTarget
from app.models.user import User
from app.schemas.certificate import (
    CertificateDetailResponse,
    CertificateRequest,
    CertificateResponse,
    CertificateStatsResponse,
)
from app.services.certificate_service import trigger_certificate_request, trigger_certificate_revoke
from app.utils.crypto import decrypt
from app.config import settings

router = APIRouter()


def _get_username(db: Session, user_id: int | None) -> str | None:
    if not user_id:
        return None
    u = db.query(User).filter(User.id == user_id).first()
    return (u.display_name or u.username) if u else None


@router.post("/dry-run")
async def dry_run_certificate(
    req: CertificateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Execute a real ACME dry-run, streaming each step as SSE. Stops before finalization."""
    import asyncio
    from app.models.provider import DnsProvider as DnsProviderModel
    from app.services.dns_providers import get_dns_provider
    from app.services.acme_service import AcmeClient
    from app.utils.crypto import (
        encrypt,
        generate_ec_key,
        load_private_key,
        serialize_private_key,
    )

    # Pre-validate and gather all DB data before entering the generator
    domains = [d.strip() for d in req.domains if d.strip()]
    ca = db.query(CertificateAuthority).filter(CertificateAuthority.id == req.ca_id).first()

    dns_prov = None
    dns_creds = None
    if req.challenge_type == "dns-01" and req.dns_provider_id:
        dns_prov = db.query(DnsProviderModel).filter(DnsProviderModel.id == req.dns_provider_id).first()
        if dns_prov and dns_prov.credentials_encrypted:
            dns_creds = json.loads(decrypt(dns_prov.credentials_encrypted))

    # Snapshot CA fields we need
    ca_snapshot = None
    if ca:
        ca_snapshot = {
            "id": ca.id,
            "name": ca.name,
            "directory_url": ca.directory_url,
            "is_staging": ca.is_staging,
            "account_key_pem": ca.account_key_pem,
            "account_url": ca.account_url,
            "contact_email": ca.contact_email,
            "eab_kid": ca.eab_kid,
            "eab_hmac_key": ca.eab_hmac_key,
            "is_global": ca.group_id is None,
            "group_id": user.group_id,
        }
        # For global CAs, overlay per-group account data
        if ca.group_id is None:
            override = db.query(CaGroupAccount).filter(
                CaGroupAccount.ca_id == ca.id,
                CaGroupAccount.group_id == user.group_id,
            ).first()
            if override:
                ca_snapshot["contact_email"] = override.contact_email
                if override.account_key_pem:
                    ca_snapshot["account_key_pem"] = override.account_key_pem
                if override.account_url:
                    ca_snapshot["account_url"] = override.account_url
            else:
                ca_snapshot["contact_email"] = None
                ca_snapshot["account_key_pem"] = None
                ca_snapshot["account_url"] = None

    dns_prov_snapshot = None
    if dns_prov:
        dns_prov_snapshot = {
            "name": dns_prov.name,
            "provider_type": dns_prov.provider_type,
            "has_credentials": bool(dns_prov.credentials_encrypted),
        }

    async def event_stream():
        step_num = 0
        has_error = False

        def make_event(title: str, description: str, status: str = "ok") -> str:
            nonlocal step_num, has_error
            step_num += 1
            if status == "error":
                has_error = True
            data = json.dumps(
                {"step": step_num, "title": title, "description": description, "status": status},
                ensure_ascii=False,
            )
            return f"data: {data}\n\n"

        def make_done(success: bool) -> str:
            return f"data: {json.dumps({'done': True, 'success': success})}\n\n"

        # 1. Validate domains
        if not domains:
            yield make_event("Validate domains", "No valid domains provided.", "error")
            yield make_done(False)
            return

        has_wildcard = any(d.startswith("*.") for d in domains)
        domain_list = ", ".join(domains)
        desc = f"Domains: {domain_list}"
        if has_wildcard:
            desc += " (contains wildcard — requires DNS-01 challenge)"
        yield make_event("Validate domains", desc)

        if has_wildcard and req.challenge_type != "dns-01":
            yield make_event(
                "Challenge type check",
                "Wildcard domains require DNS-01 challenge, but HTTP-01 is selected.",
                "error",
            )
            yield make_done(False)
            return

        # 2. Validate CA
        if not ca_snapshot:
            yield make_event("Loading Certificate Authority", f"CA met ID {req.ca_id} not found.", "error")
            yield make_done(False)
            return

        ca_desc = f"{ca_snapshot['name']} — {ca_snapshot['directory_url']}"
        if ca_snapshot["is_staging"]:
            ca_desc += " (staging)"
        yield make_event("Loading Certificate Authority", ca_desc)

        # 3. ACME directory — actually fetch it
        acme = AcmeClient(ca_snapshot["directory_url"])
        try:
            yield make_event("Fetching ACME directory", f"Connecting to {ca_snapshot['directory_url']}...")
            await asyncio.sleep(0)  # yield control
            directory = await acme.fetch_directory()
            endpoints = ", ".join(sorted(directory.keys()))
            yield make_event("Fetching ACME directory", f"Directory reachable. Endpoints: {endpoints}")
        except Exception as e:
            yield make_event("Fetching ACME directory", f"Cannot reach ACME directory: {e}", "error")
            await acme.close()
            yield make_done(False)
            return

        # 4. Account key
        try:
            if ca_snapshot["account_key_pem"]:
                account_key = load_private_key(decrypt(ca_snapshot["account_key_pem"]))
                yield make_event("Loading account key", "Existing EC account key loaded.")
            else:
                account_key = generate_ec_key()
                yield make_event("Generating account key", "New EC key pair generated (not saved in dry-run).", "warning")

            acme.account_key = account_key
        except Exception as e:
            yield make_event("Loading account key", f"Error loading account key: {e}", "error")
            await acme.close()
            yield make_done(False)
            return

        # 5. ACME account — actually register or find
        try:
            if ca_snapshot["account_url"]:
                acme.account_url = ca_snapshot["account_url"]
                yield make_event("Finding ACME account", f"Verifying existing account: {ca_snapshot['account_url']}...")
                result = await acme.find_account()
                if result:
                    yield make_event("Finding ACME account", f"Account found and verified: {result}")
                else:
                    yield make_event("Finding ACME account", "Account not found at CA. Re-registration may be needed.", "warning")
            else:
                contact_email = ca_snapshot["contact_email"] or settings.ACME_CONTACT_EMAIL
                if not contact_email:
                    yield make_event("Registering ACME account", "No contact email configured. Registration not possible.", "error")
                    await acme.close()
                    yield make_done(False)
                    return

                yield make_event("Registering ACME account", f"Registering account with contact: mailto:{contact_email}...")

                eab_kid = decrypt(ca_snapshot["eab_kid"]) if ca_snapshot["eab_kid"] else None
                eab_hmac_key = decrypt(ca_snapshot["eab_hmac_key"]) if ca_snapshot["eab_hmac_key"] else None
                if eab_kid:
                    yield make_event("External Account Binding", f"EAB credentials included (KID: {eab_kid[:8]}...)")

                account_url = await acme.register_account(
                    contact_email,
                    eab_kid=eab_kid,
                    eab_hmac_key=eab_hmac_key,
                )
                yield make_event("Registering ACME account", f"Account registered: {account_url}")

                # Persist the new account in the DB so it's not wasted
                from app.database import SessionLocal
                persist_db = SessionLocal()
                try:
                    if ca_snapshot.get("is_global"):
                        # Global CA — save to per-group override
                        override = persist_db.query(CaGroupAccount).filter(
                            CaGroupAccount.ca_id == ca_snapshot["id"],
                            CaGroupAccount.group_id == ca_snapshot["group_id"],
                        ).first()
                        if not override:
                            override = CaGroupAccount(
                                ca_id=ca_snapshot["id"],
                                group_id=ca_snapshot["group_id"],
                            )
                            persist_db.add(override)
                        if not override.account_key_pem:
                            override.account_key_pem = encrypt(serialize_private_key(account_key))
                        override.account_url = account_url
                        persist_db.commit()
                    else:
                        persist_ca = persist_db.query(CertificateAuthority).filter(
                            CertificateAuthority.id == ca_snapshot["id"]
                        ).first()
                        if persist_ca:
                            if not persist_ca.account_key_pem:
                                persist_ca.account_key_pem = encrypt(serialize_private_key(account_key))
                            persist_ca.account_url = account_url
                            persist_db.commit()
                    yield make_event("Saving account", "New ACME account saved to database (reusable).")
                finally:
                    persist_db.close()

        except Exception as e:
            yield make_event("ACME account", f"Account registration/verification failed: {e}", "error")
            await acme.close()
            yield make_done(False)
            return

        # 6. DNS provider check
        dns_provider_instance = None
        if req.challenge_type == "dns-01":
            if not req.dns_provider_id or not dns_prov_snapshot:
                yield make_event("Checking DNS provider", "No DNS provider selected for DNS-01 challenge.", "error")
                await acme.close()
                yield make_done(False)
                return

            if not dns_prov_snapshot["has_credentials"]:
                yield make_event("Checking DNS provider", f"{dns_prov_snapshot['name']} — no credentials configured.", "error")
                await acme.close()
                yield make_done(False)
                return

            yield make_event("Checking DNS provider", f"{dns_prov_snapshot['name']} ({dns_prov_snapshot['provider_type']}) — credentials available.")
            dns_provider_instance = get_dns_provider(dns_prov_snapshot["provider_type"], dns_creds)

        # 7. Create ACME order — actually do it
        try:
            yield make_event("Creating ACME order", f"Creating order for: {domain_list}...")
            order_url, order = await acme.create_order(domains)
            authz_count = len(order.get("authorizations", []))
            yield make_event(
                "Creating ACME order",
                f"Order created: {order_url} — {authz_count} authorization(s) required. Status: {order['status']}",
            )
        except Exception as e:
            yield make_event("Creating ACME order", f"Order creation failed: {e}", "error")
            await acme.close()
            yield make_done(False)
            return

        # 8. Process each authorization — actually do challenges
        cleanup_records = []  # Track DNS records to clean up
        all_authz_ok = True

        for authz_url in order.get("authorizations", []):
            try:
                authz = await acme.get_authorization(authz_url)
                domain = authz["identifier"]["value"]
                authz_status = authz["status"]

                if authz_status == "valid":
                    yield make_event(
                        f"Authorization: {domain}",
                        f"Domain already authorized (status: valid). No challenge needed.",
                    )
                    continue

                available_types = [c["type"] for c in authz["challenges"]]
                yield make_event(
                    f"Authorization: {domain}",
                    f"Status: {authz_status}. Available challenges: {', '.join(available_types)}",
                )

                challenge = acme.select_challenge(authz, req.challenge_type)
                token = challenge["token"]
                key_auth = acme.get_key_authorization(token)

                if req.challenge_type == "dns-01" and dns_provider_instance:
                    dns_value = acme.get_dns_challenge_value(key_auth)
                    clean_domain = domain.lstrip("*.")
                    record_name = f"_acme-challenge.{clean_domain}"

                    yield make_event(
                        f"Creating DNS record: {domain}",
                        f"TXT record '{record_name}' creating with value: {dns_value[:20]}...",
                    )

                    await dns_provider_instance.create_txt_record(clean_domain, record_name, dns_value)
                    cleanup_records.append((clean_domain, record_name, dns_value))

                    yield make_event(
                        f"Creating DNS record: {domain}",
                        f"TXT record '{record_name}' created. Waiting for DNS propagation (30s)...",
                    )
                    await asyncio.sleep(30)

                # Respond to challenge
                yield make_event(
                    f"Responding to challenge: {domain}",
                    f"Sending challenge response to ACME server...",
                )
                await acme.respond_to_challenge(challenge["url"])

                # Poll authorization
                yield make_event(
                    f"Waiting for validation: {domain}",
                    f"Waiting for ACME server to validate the challenge...",
                )
                validated_authz = await acme.poll_authorization(authz_url, timeout=120)
                yield make_event(
                    f"Validation succeeded: {domain}",
                    f"Domain {domain} successfully validated! Status: {validated_authz['status']}",
                )

            except Exception as e:
                yield make_event(f"Authorization failed: {domain}", f"Error: {e}", "error")
                all_authz_ok = False
                break

            finally:
                # Clean up DNS records for this domain
                if req.challenge_type == "dns-01" and dns_provider_instance:
                    for clean_d, rec_name, rec_value in cleanup_records:
                        try:
                            await dns_provider_instance.delete_txt_record(clean_d, rec_name, rec_value)
                            yield make_event(f"DNS cleanup: {rec_name}", f"TXT record deleted.")
                        except Exception as cleanup_err:
                            yield make_event(f"DNS cleanup: {rec_name}", f"Could not delete record: {cleanup_err}", "warning")
                    cleanup_records.clear()

        await acme.close()

        if not all_authz_ok:
            yield make_done(False)
            return

        # 9. CSR info (don't actually finalize)
        oid_desc = ""
        if req.custom_oids:
            valid_oids = [o for o in req.custom_oids if o.oid.strip() and o.value.strip()]
            if valid_oids:
                oid_list = ", ".join(f"{o.oid} ({o.value})" for o in valid_oids)
                oid_desc = f" With custom OIDs: {oid_list}."
        yield make_event(
            "CSR & finalization (skipped)",
            f"In a real request, an RSA-2048 key pair + CSR would be generated for: {domain_list}.{oid_desc} "
            f"The order would be finalized and the certificate downloaded. "
            f"This step was skipped in dry-run mode.",
            "warning",
        )

        # 10. Summary
        yield make_event(
            "Dry-run completed",
            f"All steps completed successfully. The certificate can be requested.",
        )

        yield make_done(True)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/stats", response_model=CertificateStatsResponse)
def get_stats(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    now = datetime.now(timezone.utc)
    threshold = now + timedelta(days=settings.RENEWAL_THRESHOLD_DAYS)

    gids = visible_group_ids(db, user, "certificates")
    base = db.query(Certificate).filter(Certificate.group_id.in_(gids))
    total = base.count()
    active = base.filter(Certificate.status == "valid").count()
    expiring_soon = (
        base
        .filter(
            Certificate.status == "valid",
            Certificate.expires_at <= threshold,
            Certificate.expires_at > now,
        )
        .count()
    )
    expired = base.filter(Certificate.status == "expired").count()
    pending = (
        base
        .filter(Certificate.status.in_(["pending", "processing", "renewing"]))
        .count()
    )
    error = base.filter(Certificate.status == "error").count()

    return CertificateStatsResponse(
        total=total,
        active=active,
        expiring_soon=expiring_soon,
        expired=expired,
        pending=pending,
        error=error,
    )


@router.get("", response_model=list[CertificateResponse])
def list_certificates(
    status: str | None = None,
    search: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    query = db.query(Certificate).filter(Certificate.group_id.in_(visible_group_ids(db, user, "certificates")))
    if status:
        query = query.filter(Certificate.status == status)
    if search:
        query = query.filter(Certificate.common_name.ilike(f"%{search}%"))
    query = query.order_by(Certificate.created_at.desc())
    certs = query.all()

    result = []
    for cert in certs:
        ca = (
            db.query(CertificateAuthority)
            .filter(CertificateAuthority.id == cert.ca_id)
            .first()
        )
        resp = CertificateResponse.model_validate(cert)
        resp.ca_name = ca.name if ca else None
        resp.created_by_username = _get_username(db, cert.created_by_user_id)
        resp.modified_by_username = _get_username(db, cert.modified_by_user_id)
        result.append(resp)
    return result


@router.get("/{cert_id}", response_model=CertificateDetailResponse)
def get_certificate(
    cert_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    cert = db.query(Certificate).filter(Certificate.id == cert_id, Certificate.group_id.in_(visible_group_ids(db, user, "certificates"))).first()
    if not cert:
        raise HTTPException(status_code=404, detail="Certificate not found")

    ca = (
        db.query(CertificateAuthority)
        .filter(CertificateAuthority.id == cert.ca_id)
        .first()
    )
    resp = CertificateDetailResponse.model_validate(cert)
    resp.ca_name = ca.name if ca else None
    resp.created_by_username = _get_username(db, cert.created_by_user_id)
    resp.modified_by_username = _get_username(db, cert.modified_by_user_id)
    return resp


def _parse_x509_details(pem_str: str) -> dict:
    """Parse a PEM certificate and return structured details."""
    from cryptography import x509
    from cryptography.hazmat.primitives.asymmetric import ec, rsa, ed25519, ed448

    cert_obj = x509.load_pem_x509_certificate(pem_str.encode())

    def _name_to_dict(name: x509.Name) -> dict[str, str]:
        result = {}
        oid_names = {
            x509.oid.NameOID.COMMON_NAME: "CN",
            x509.oid.NameOID.ORGANIZATION_NAME: "O",
            x509.oid.NameOID.ORGANIZATIONAL_UNIT_NAME: "OU",
            x509.oid.NameOID.COUNTRY_NAME: "C",
            x509.oid.NameOID.STATE_OR_PROVINCE_NAME: "ST",
            x509.oid.NameOID.LOCALITY_NAME: "L",
        }
        for attr in name:
            label = oid_names.get(attr.oid, attr.oid.dotted_string)
            result[label] = attr.value
        return result

    pub = cert_obj.public_key()
    if isinstance(pub, rsa.RSAPublicKey):
        key_type = "RSA"
        key_size = f"{pub.key_size} bit"
    elif isinstance(pub, ec.EllipticCurvePublicKey):
        key_type = "EC"
        key_size = f"{pub.curve.name} ({pub.key_size} bit)"
    elif isinstance(pub, (ed25519.Ed25519PublicKey, ed448.Ed448PublicKey)):
        key_type = type(pub).__name__.replace("PublicKey", "")
        key_size = ""
    else:
        key_type = type(pub).__name__
        key_size = ""

    details: dict = {
        "subject": _name_to_dict(cert_obj.subject),
        "issuer": _name_to_dict(cert_obj.issuer),
        "serial_number": format(cert_obj.serial_number, "X"),
        "not_before": cert_obj.not_valid_before_utc.isoformat(),
        "not_after": cert_obj.not_valid_after_utc.isoformat(),
        "signature_algorithm": cert_obj.signature_algorithm_oid._name,
        "public_key_algorithm": key_type,
        "public_key_size": key_size,
        "version": f"v{cert_obj.version.value + 1}",
    }

    # Extensions
    extensions = {}
    try:
        san = cert_obj.extensions.get_extension_for_class(x509.SubjectAlternativeName)
        extensions["subject_alternative_names"] = san.value.get_values_for_type(x509.DNSName)
    except x509.ExtensionNotFound:
        pass

    try:
        ku = cert_obj.extensions.get_extension_for_class(x509.KeyUsage)
        usages = []
        for attr in ["digital_signature", "key_encipherment", "content_commitment",
                      "data_encipherment", "key_agreement", "key_cert_sign",
                      "crl_sign"]:
            if getattr(ku.value, attr, False):
                usages.append(attr)
        extensions["key_usage"] = usages
        extensions["key_usage_critical"] = ku.critical
    except x509.ExtensionNotFound:
        pass

    try:
        eku = cert_obj.extensions.get_extension_for_class(x509.ExtendedKeyUsage)
        extensions["extended_key_usage"] = [u._name for u in eku.value]
    except x509.ExtensionNotFound:
        pass

    try:
        bc = cert_obj.extensions.get_extension_for_class(x509.BasicConstraints)
        extensions["basic_constraints"] = {
            "ca": bc.value.ca,
            "path_length": bc.value.path_length,
            "critical": bc.critical,
        }
    except x509.ExtensionNotFound:
        pass

    try:
        ski = cert_obj.extensions.get_extension_for_class(x509.SubjectKeyIdentifier)
        extensions["subject_key_identifier"] = ski.value.digest.hex(":")
    except x509.ExtensionNotFound:
        pass

    try:
        aki = cert_obj.extensions.get_extension_for_class(x509.AuthorityKeyIdentifier)
        if aki.value.key_identifier:
            extensions["authority_key_identifier"] = aki.value.key_identifier.hex(":")
    except x509.ExtensionNotFound:
        pass

    try:
        aia = cert_obj.extensions.get_extension_for_class(x509.AuthorityInformationAccess)
        ocsp_urls = []
        ca_issuers = []
        for desc in aia.value:
            if desc.access_method == x509.oid.AuthorityInformationAccessOID.OCSP:
                ocsp_urls.append(desc.access_location.value)
            elif desc.access_method == x509.oid.AuthorityInformationAccessOID.CA_ISSUERS:
                ca_issuers.append(desc.access_location.value)
        if ocsp_urls:
            extensions["ocsp_urls"] = ocsp_urls
        if ca_issuers:
            extensions["ca_issuer_urls"] = ca_issuers
    except x509.ExtensionNotFound:
        pass

    try:
        crl = cert_obj.extensions.get_extension_for_class(x509.CRLDistributionPoints)
        crl_urls = []
        for dp in crl.value:
            if dp.full_name:
                for name in dp.full_name:
                    crl_urls.append(name.value)
        if crl_urls:
            extensions["crl_distribution_points"] = crl_urls
    except x509.ExtensionNotFound:
        pass

    try:
        ct_scts = cert_obj.extensions.get_extension_for_class(
            x509.PrecertificateSignedCertificateTimestamps
        )
        extensions["sct_count"] = len(ct_scts.value)
    except x509.ExtensionNotFound:
        pass

    details["extensions"] = extensions
    return details


@router.get("/{cert_id}/parsed")
def get_certificate_parsed(
    cert_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Returns parsed X.509 details for the certificate and its chain."""
    cert = db.query(Certificate).filter(Certificate.id == cert_id, Certificate.group_id.in_(visible_group_ids(db, user, "certificates"))).first()
    if not cert:
        raise HTTPException(status_code=404, detail="Certificate not found")
    if not cert.certificate_pem:
        raise HTTPException(status_code=400, detail="Certificate has not been issued yet")

    result = {"certificate": _parse_x509_details(cert.certificate_pem)}

    if cert.chain_pem:
        chain_certs = []
        # Split chain PEM into individual certificates
        pem_blocks = cert.chain_pem.strip().split("-----END CERTIFICATE-----")
        for block in pem_blocks:
            block = block.strip()
            if block:
                pem = block + "\n-----END CERTIFICATE-----\n"
                try:
                    chain_certs.append(_parse_x509_details(pem))
                except Exception:
                    pass
        result["chain"] = chain_certs

    return result


@router.post("/request", response_model=CertificateResponse)
def request_certificate(
    req: CertificateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ca = (
        db.query(CertificateAuthority)
        .filter(CertificateAuthority.id == req.ca_id)
        .first()
    )
    if not ca:
        raise HTTPException(status_code=400, detail="Certificate Authority not found")

    domains = req.domains
    if not domains:
        raise HTTPException(status_code=400, detail="At least one domain required")

    # Prevent duplicate: check if an active certificate with the same common name
    # already exists for this CA within the user's group
    existing = (
        db.query(Certificate)
        .filter(
            Certificate.common_name == domains[0],
            Certificate.ca_id == req.ca_id,
            Certificate.group_id == user.group_id,
            Certificate.status.notin_(["failed", "revoked"]),
        )
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"A certificate for '{domains[0]}' already exists (status: {existing.status})",
        )

    san_domains = json.dumps(domains) if len(domains) > 1 else None

    custom_oids_json = None
    if req.custom_oids:
        custom_oids_json = json.dumps([o.model_dump() for o in req.custom_oids])

    # Validate target if provided
    target = None
    if req.target_id:
        target = (
            db.query(DeploymentTarget)
            .filter(DeploymentTarget.id == req.target_id)
            .first()
        )
        if not target:
            raise HTTPException(status_code=400, detail="Deployment target not found")

    cert = Certificate(
        common_name=domains[0],
        san_domains=san_domains,
        ca_id=req.ca_id,
        dns_provider_id=req.dns_provider_id,
        challenge_type=req.challenge_type,
        auto_renew=req.auto_renew,
        renewal_threshold_days=req.renewal_threshold_days,
        custom_oids=custom_oids_json,
        country=req.country,
        state=req.state,
        locality=req.locality,
        organization=req.organization,
        organizational_unit=req.organizational_unit,
        status="pending",
        group_id=user.group_id,
        created_by_user_id=user.id,
    )
    db.add(cert)
    db.commit()
    db.refresh(cert)

    # Auto-create deployment if target specified
    if target:
        deployment = CertificateDeployment(
            certificate_id=cert.id,
            target_id=target.id,
            deploy_format=req.deploy_format,
            status="pending",
        )
        db.add(deployment)
        db.commit()

    trigger_certificate_request(cert.id)

    from app.services.email_service import notify_certificate_requested
    from app.services.notification_service import create_notification
    from app.utils.time import format_now
    notify_certificate_requested(
        group_id=user.group_id,
        common_name=cert.common_name,
        requested_by=user.display_name or user.username,
        requested_at=format_now(),
    )
    create_notification(
        group_id=user.group_id,
        type="cert_requested",
        resource_type="certificate",
        resource_id=cert.id,
        title=f"Certificate requested: {cert.common_name}",
        message=f"Certificate {cert.common_name} was requested by {user.display_name or user.username}.",
        actor=user.display_name or user.username,
        db=db,
    )

    resp = CertificateResponse.model_validate(cert)
    resp.ca_name = ca.name
    resp.created_by_username = user.display_name or user.username
    return resp


@router.post("/{cert_id}/renew", response_model=CertificateResponse)
def renew_certificate(
    cert_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    cert = db.query(Certificate).filter(Certificate.id == cert_id, Certificate.group_id.in_(visible_group_ids(db, user, "certificates"))).first()
    if not cert:
        raise HTTPException(status_code=404, detail="Certificate not found")

    if cert.status in ("pending", "processing", "renewing"):
        raise HTTPException(
            status_code=400,
            detail="A request or renewal is already in progress for this certificate.",
        )

    if cert.issued_at:
        issued = cert.issued_at if cert.issued_at.tzinfo else cert.issued_at.replace(tzinfo=timezone.utc)
        days_since_issued = (datetime.now(timezone.utc) - issued).days
        if days_since_issued < 7:
            raise HTTPException(
            status_code=400,
            detail=f"This certificate was issued {days_since_issued} day(s) ago. "
                   f"Renewal is possible after 7 days to avoid rate limits.",
        )

    cert.status = "renewing"
    cert.modified_by_user_id = user.id
    db.commit()
    trigger_certificate_request(cert.id)

    ca = (
        db.query(CertificateAuthority)
        .filter(CertificateAuthority.id == cert.ca_id)
        .first()
    )
    resp = CertificateResponse.model_validate(cert)
    resp.ca_name = ca.name if ca else None
    resp.created_by_username = _get_username(db, cert.created_by_user_id)
    resp.modified_by_username = user.display_name or user.username
    return resp


@router.post("/{cert_id}/revoke", response_model=CertificateResponse)
def revoke_certificate(
    cert_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    cert = db.query(Certificate).filter(Certificate.id == cert_id, Certificate.group_id.in_(visible_group_ids(db, user, "certificates"))).first()
    if not cert or not cert.certificate_pem:
        raise HTTPException(
            status_code=400, detail="Certificate not found or not yet issued"
        )
    if cert.status == "revoked":
        raise HTTPException(status_code=400, detail="Certificate is already revoked")

    cert.status = "revoking"
    db.commit()
    trigger_certificate_revoke(cert.id)

    ca = (
        db.query(CertificateAuthority)
        .filter(CertificateAuthority.id == cert.ca_id)
        .first()
    )
    resp = CertificateResponse.model_validate(cert)
    resp.ca_name = ca.name if ca else None
    resp.created_by_username = _get_username(db, cert.created_by_user_id)
    resp.modified_by_username = _get_username(db, cert.modified_by_user_id)
    return resp


@router.patch("/{cert_id}", response_model=CertificateResponse, summary="Update certificate settings")
def update_certificate(
    cert_id: int,
    auto_renew: bool | None = Query(default=None),
    renewal_threshold_days: int | None = Query(default=None, ge=1, le=365),
    clear_threshold: bool = Query(default=False, description="Set renewal_threshold_days to null (use system default)"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Update mutable settings of an existing ACME certificate (auto-renewal on/off, threshold)."""
    cert = db.query(Certificate).filter(
        Certificate.id == cert_id,
        Certificate.group_id.in_(visible_group_ids(db, user, "certificates")),
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

    ca = db.query(CertificateAuthority).filter(CertificateAuthority.id == cert.ca_id).first()
    resp = CertificateResponse.model_validate(cert)
    resp.ca_name = ca.name if ca else None
    resp.created_by_username = _get_username(db, cert.created_by_user_id)
    resp.modified_by_username = _get_username(db, cert.modified_by_user_id)
    return resp


@router.delete("/{cert_id}")
def delete_certificate(
    cert_id: int,
    force: bool = Query(False),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    cert = db.query(Certificate).filter(Certificate.id == cert_id, Certificate.group_id.in_(visible_group_ids(db, user, "certificates"))).first()
    if not cert:
        raise HTTPException(status_code=404, detail="Certificate not found")

    common_name = cert.common_name
    cert_group_id = cert.group_id

    from app.models.deployment import AgentCertificate, CertificateDeployment, DeploymentTarget

    assignments = (
        db.query(AgentCertificate)
        .join(DeploymentTarget, AgentCertificate.target_id == DeploymentTarget.id)
        .filter(AgentCertificate.certificate_id == cert_id)
        .all()
    )
    active_deployments = (
        db.query(CertificateDeployment)
        .filter(
            CertificateDeployment.certificate_id == cert_id,
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

    # Force delete: mark deployed certs for removal on agents, then clean up
    # Store common_name on deployments so agents can still find the files
    deployed = (
        db.query(CertificateDeployment)
        .filter(
            CertificateDeployment.certificate_id == cert_id,
            CertificateDeployment.status.in_(["deployed", "failed"]),
        )
        .all()
    )
    for dep in deployed:
        dep.common_name = cert.common_name
        dep.status = "pending_removal"
        dep.certificate_id = None

    # Delete deployments that haven't been deployed yet (no files on agent)
    db.query(CertificateDeployment).filter(
        CertificateDeployment.certificate_id == cert_id,
        CertificateDeployment.status.in_(["pending"]),
    ).delete(synchronize_session="fetch")

    # Remove agent certificate assignments
    db.query(AgentCertificate).filter(
        AgentCertificate.certificate_id == cert_id
    ).delete()

    db.delete(cert)
    db.commit()

    from app.services.email_service import notify_certificate_deleted
    from app.services.notification_service import create_notification
    from app.utils.time import format_now
    notify_certificate_deleted(
        group_id=cert_group_id,
        common_name=common_name,
        deleted_by=user.display_name or user.username,
        deleted_at=format_now(),
    )
    create_notification(
        group_id=cert_group_id,
        type="cert_deleted",
        resource_type="certificate",
        resource_id=cert_id,
        title=f"Certificate deleted: {common_name}",
        message=f"Certificate {common_name} was deleted by {user.display_name or user.username}.",
        actor=user.display_name or user.username,
    )

    return {"detail": "Certificate deleted"}


@router.post("/{cert_id}/download/zip")
def download_zip(
    cert_id: int,
    password: str | None = Body(None, embed=True),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    cert = db.query(Certificate).filter(Certificate.id == cert_id, Certificate.group_id.in_(visible_group_ids(db, user, "certificates"))).first()
    if not cert or not cert.certificate_pem:
        raise HTTPException(status_code=404, detail="Certificate not found or not yet issued")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        safe_name = cert.common_name.replace("*", "_wildcard")
        zf.writestr(f"{safe_name}/certificate.pem", cert.certificate_pem)
        if cert.chain_pem:
            zf.writestr(f"{safe_name}/chain.pem", cert.chain_pem)
            fullchain = cert.certificate_pem.strip() + "\n" + cert.chain_pem.strip() + "\n"
            zf.writestr(f"{safe_name}/fullchain.pem", fullchain)
        if cert.private_key_pem_encrypted:
            key_pem = decrypt(cert.private_key_pem_encrypted)
            if password:
                from cryptography.hazmat.primitives import serialization
                from cryptography.hazmat.primitives.serialization import load_pem_private_key, BestAvailableEncryption
                priv_key = load_pem_private_key(key_pem.encode(), password=None)
                encrypted_pem = priv_key.private_bytes(
                    encoding=serialization.Encoding.PEM,
                    format=serialization.PrivateFormat.PKCS8,
                    encryption_algorithm=BestAvailableEncryption(password.encode("utf-8")),
                ).decode()
                zf.writestr(f"{safe_name}/private_key.pem", encrypted_pem)
            else:
                zf.writestr(f"{safe_name}/private_key.pem", key_pem)

    buf.seek(0)
    safe_name = cert.common_name.replace("*", "_wildcard")
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}.zip"'},
    )


@router.post("/{cert_id}/download/pem/{file_type}")
def download_pem(
    cert_id: int,
    file_type: str,
    password: str | None = Body(None, embed=True),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    cert = db.query(Certificate).filter(Certificate.id == cert_id).first()
    if not cert or not cert.certificate_pem:
        raise HTTPException(status_code=404, detail="Certificate not found or not yet issued")

    safe_name = cert.common_name.replace("*", "_wildcard")

    if file_type == "certificate":
        content = cert.certificate_pem
        filename = f"{safe_name}_certificate.pem"
    elif file_type == "chain":
        if not cert.chain_pem:
            raise HTTPException(status_code=404, detail="Chain not available")
        content = cert.chain_pem
        filename = f"{safe_name}_chain.pem"
    elif file_type == "fullchain":
        chain = cert.chain_pem or ""
        content = cert.certificate_pem.strip() + "\n" + chain.strip() + "\n"
        filename = f"{safe_name}_fullchain.pem"
    elif file_type == "privatekey":
        if not cert.private_key_pem_encrypted:
            raise HTTPException(status_code=404, detail="Private key not available")
        key_pem = decrypt(cert.private_key_pem_encrypted)
        if password:
            from cryptography.hazmat.primitives import serialization
            from cryptography.hazmat.primitives.serialization import load_pem_private_key, BestAvailableEncryption
            priv_key = load_pem_private_key(key_pem.encode(), password=None)
            content = priv_key.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.PKCS8,
                encryption_algorithm=BestAvailableEncryption(password.encode("utf-8")),
            ).decode()
        else:
            content = key_pem
        filename = f"{safe_name}_private_key.pem"
    elif file_type == "combined":
        if not cert.private_key_pem_encrypted:
            raise HTTPException(status_code=404, detail="Private key not available")
        key_pem = decrypt(cert.private_key_pem_encrypted)
        chain = cert.chain_pem or ""
        parts = [key_pem.strip(), cert.certificate_pem.strip()]
        if chain.strip():
            parts.append(chain.strip())
        content = "\n".join(parts) + "\n"
        filename = f"{safe_name}_combined.pem"
    else:
        raise HTTPException(status_code=400, detail="Invalid file type. Use: certificate, chain, fullchain, privatekey, combined")

    return StreamingResponse(
        io.BytesIO(content.encode()),
        media_type="application/x-pem-file",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/{cert_id}/download/pfx")
def download_pfx(
    cert_id: int,
    password: str | None = Body(None, embed=True),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    cert = db.query(Certificate).filter(Certificate.id == cert_id).first()
    if not cert or not cert.certificate_pem:
        raise HTTPException(status_code=404, detail="Certificate not found or not yet issued")
    if not cert.private_key_pem_encrypted:
        raise HTTPException(status_code=404, detail="Private key not available")

    from cryptography.hazmat.primitives.serialization import pkcs12, load_pem_private_key, NoEncryption, BestAvailableEncryption
    from cryptography import x509 as cx509

    key_pem = decrypt(cert.private_key_pem_encrypted)
    priv_key = load_pem_private_key(key_pem.encode(), password=None)
    cert_obj = cx509.load_pem_x509_certificate(cert.certificate_pem.encode())

    ca_certs = None
    if cert.chain_pem and cert.chain_pem.strip():
        ca_certs = []
        chain_data = cert.chain_pem.strip()
        pem_blocks = chain_data.split("-----END CERTIFICATE-----")
        for block in pem_blocks:
            block = block.strip()
            if block:
                pem = block + "-----END CERTIFICATE-----\n"
                ca_certs.append(cx509.load_pem_x509_certificate(pem.encode()))
        if not ca_certs:
            ca_certs = None

    pfx_password = password.encode("utf-8") if password else None
    pfx_name = cert.common_name.encode("utf-8")

    pfx_data = pkcs12.serialize_key_and_certificates(
        name=pfx_name,
        key=priv_key,
        cert=cert_obj,
        cas=ca_certs,
        encryption_algorithm=(
            BestAvailableEncryption(pfx_password)
            if pfx_password
            else NoEncryption()
        ),
    )

    safe_name = cert.common_name.replace("*", "_wildcard")
    return StreamingResponse(
        io.BytesIO(pfx_data),
        media_type="application/x-pkcs12",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}.pfx"'},
    )
