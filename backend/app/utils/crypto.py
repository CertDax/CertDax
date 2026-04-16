import base64
import hashlib
import json
import logging
import os
import secrets

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from cryptography.x509.oid import NameOID
from cryptography import x509

from app.config import settings

logger = logging.getLogger(__name__)

_fernet: Fernet | None = None


def ensure_encryption_key():
    global _fernet
    if settings.ENCRYPTION_KEY:
        _fernet = Fernet(settings.ENCRYPTION_KEY.encode())
    else:
        key_path = "data/.encryption_key"
        if os.path.exists(key_path):
            with open(key_path, "r") as f:
                key = f.read().strip()
        else:
            key = Fernet.generate_key().decode()
            os.makedirs("data", exist_ok=True)
            with open(key_path, "w") as f:
                f.write(key)
            os.chmod(key_path, 0o600)
        _fernet = Fernet(key.encode())
        logger.warning(
            "ENCRYPTION_KEY not set — using filesystem key at data/.encryption_key. "
            "This is NOT safe for multi-node deployments (Swarm/K8s). "
            "Set ENCRYPTION_KEY in your environment for production clusters."
        )


def encrypt(data: str) -> str:
    if _fernet is None:
        ensure_encryption_key()
    return _fernet.encrypt(data.encode()).decode()


def decrypt(data: str) -> str:
    if _fernet is None:
        ensure_encryption_key()
    return _fernet.decrypt(data.encode()).decode()


def generate_agent_token() -> tuple[str, str]:
    token = secrets.token_hex(32)
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    return token, token_hash


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def base64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def base64url_decode(data: str) -> bytes:
    padding = 4 - len(data) % 4
    if padding != 4:
        data += "=" * padding
    return base64.urlsafe_b64decode(data)


def generate_ec_key() -> ec.EllipticCurvePrivateKey:
    return ec.generate_private_key(ec.SECP256R1())


def generate_rsa_key(key_size: int = 4096) -> rsa.RSAPrivateKey:
    return rsa.generate_private_key(public_exponent=65537, key_size=key_size)


def serialize_private_key(key) -> str:
    return key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode()


def load_private_key(pem_data: str):
    return serialization.load_pem_private_key(pem_data.encode(), password=None)


def get_jwk(key: ec.EllipticCurvePrivateKey) -> dict:
    public_key = key.public_key()
    numbers = public_key.public_numbers()
    return {
        "crv": "P-256",
        "kty": "EC",
        "x": base64url_encode(numbers.x.to_bytes(32, "big")),
        "y": base64url_encode(numbers.y.to_bytes(32, "big")),
    }


def jwk_thumbprint(key: ec.EllipticCurvePrivateKey) -> str:
    jwk = get_jwk(key)
    thumbprint_input = json.dumps(jwk, sort_keys=True, separators=(",", ":")).encode()
    digest = hashes.Hash(hashes.SHA256())
    digest.update(thumbprint_input)
    return base64url_encode(digest.finalize())


def sign_jws(
    key: ec.EllipticCurvePrivateKey,
    url: str,
    nonce: str,
    payload,
    jwk: dict | None = None,
    kid: str | None = None,
) -> dict:
    header = {"alg": "ES256", "nonce": nonce, "url": url}
    if jwk:
        header["jwk"] = jwk
    elif kid:
        header["kid"] = kid

    protected = base64url_encode(json.dumps(header).encode())

    if payload is None or payload == "":
        payload_b64 = ""
    else:
        payload_b64 = base64url_encode(json.dumps(payload).encode())

    signing_input = f"{protected}.{payload_b64}".encode()
    der_sig = key.sign(signing_input, ec.ECDSA(hashes.SHA256()))
    r, s = decode_dss_signature(der_sig)
    sig_bytes = r.to_bytes(32, "big") + s.to_bytes(32, "big")

    return {
        "protected": protected,
        "payload": payload_b64,
        "signature": base64url_encode(sig_bytes),
    }


def create_csr(
    private_key: rsa.RSAPrivateKey,
    domains: list[str],
    custom_oids: list[dict] | None = None,
    country: str | None = None,
    state: str | None = None,
    locality: str | None = None,
    organization: str | None = None,
    organizational_unit: str | None = None,
) -> bytes:
    common_name = domains[0]
    builder = x509.CertificateSigningRequestBuilder()

    name_attrs = [x509.NameAttribute(NameOID.COMMON_NAME, common_name)]
    if country:
        name_attrs.append(x509.NameAttribute(NameOID.COUNTRY_NAME, country))
    if state:
        name_attrs.append(x509.NameAttribute(NameOID.STATE_OR_PROVINCE_NAME, state))
    if locality:
        name_attrs.append(x509.NameAttribute(NameOID.LOCALITY_NAME, locality))
    if organization:
        name_attrs.append(x509.NameAttribute(NameOID.ORGANIZATION_NAME, organization))
    if organizational_unit:
        name_attrs.append(x509.NameAttribute(NameOID.ORGANIZATIONAL_UNIT_NAME, organizational_unit))
    if custom_oids:
        for oid_entry in custom_oids:
            oid_obj = x509.ObjectIdentifier(oid_entry["oid"])
            name_attrs.append(x509.NameAttribute(oid_obj, oid_entry["value"]))
    builder = builder.subject_name(x509.Name(name_attrs))

    san_list = [x509.DNSName(d) for d in domains]
    builder = builder.add_extension(
        x509.SubjectAlternativeName(san_list), critical=False
    )

    if custom_oids:
        eku_oids = [
            e for e in custom_oids
            if e["oid"].startswith("1.3.6.1.5.5.7.3.")
            or e["oid"].startswith("1.3.6.1.4.1.")
        ]
        if eku_oids:
            eku_list = [x509.ObjectIdentifier(e["oid"]) for e in eku_oids]
            builder = builder.add_extension(
                x509.ExtendedKeyUsage(eku_list), critical=False
            )

    csr = builder.sign(private_key, hashes.SHA256())
    return csr.public_bytes(serialization.Encoding.DER)


def parse_certificate_dates(pem_data: str) -> tuple:
    cert = x509.load_pem_x509_certificate(pem_data.encode())
    return cert.not_valid_before_utc, cert.not_valid_after_utc


def parse_certificate_domains(pem_data: str) -> list[str]:
    cert = x509.load_pem_x509_certificate(pem_data.encode())
    domains = []
    try:
        san = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName)
        domains = san.value.get_values_for_type(x509.DNSName)
    except x509.ExtensionNotFound:
        cn = cert.subject.get_attributes_for_oid(NameOID.COMMON_NAME)
        if cn:
            domains = [cn[0].value]
    return domains
