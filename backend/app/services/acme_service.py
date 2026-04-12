import asyncio
import json
import logging
import time

import httpx

from app.utils.crypto import (
    base64url_encode,
    create_csr,
    decrypt,
    encrypt,
    generate_ec_key,
    generate_rsa_key,
    get_jwk,
    jwk_thumbprint,
    load_private_key,
    parse_certificate_dates,
    serialize_private_key,
    sign_jws,
)

logger = logging.getLogger(__name__)

LETS_ENCRYPT_PRODUCTION = "https://acme-v02.api.letsencrypt.org/directory"
LETS_ENCRYPT_STAGING = "https://acme-staging-v02.api.letsencrypt.org/directory"


class AcmeError(Exception):
    pass


class AcmeClient:
    def __init__(self, directory_url: str):
        self.directory_url = directory_url
        self.directory: dict | None = None
        self.nonce: str | None = None
        self.account_key = None
        self.account_url: str | None = None
        self.client = httpx.AsyncClient(timeout=30.0)

    async def close(self):
        await self.client.aclose()

    async def fetch_directory(self):
        resp = await self.client.get(self.directory_url)
        resp.raise_for_status()
        self.directory = resp.json()
        return self.directory

    async def get_nonce(self):
        if self.nonce:
            nonce = self.nonce
            self.nonce = None
            return nonce
        resp = await self.client.head(self.directory["newNonce"])
        return resp.headers["Replay-Nonce"]

    def _update_nonce(self, response: httpx.Response):
        if "Replay-Nonce" in response.headers:
            self.nonce = response.headers["Replay-Nonce"]

    async def _signed_request(self, url: str, payload, use_jwk: bool = False):
        nonce = await self.get_nonce()
        if use_jwk:
            body = sign_jws(
                self.account_key, url, nonce, payload, jwk=get_jwk(self.account_key)
            )
        else:
            body = sign_jws(
                self.account_key, url, nonce, payload, kid=self.account_url
            )

        resp = await self.client.post(
            url, json=body, headers={"Content-Type": "application/jose+json"}
        )
        self._update_nonce(resp)
        return resp

    async def register_account(
        self, contact_email: str, eab_kid: str | None = None, eab_hmac_key: str | None = None
    ) -> str:
        if not self.directory:
            await self.fetch_directory()

        payload = {
            "termsOfServiceAgreed": True,
            "contact": [f"mailto:{contact_email}"],
        }

        # External Account Binding (e.g. Networking4All, ZeroSSL)
        if eab_kid and eab_hmac_key:
            import base64
            import hmac
            import hashlib

            account_jwk = get_jwk(self.account_key)
            eab_protected = base64url_encode(
                json.dumps({"alg": "HS256", "kid": eab_kid, "url": self.directory["newAccount"]}).encode()
            )
            eab_payload = base64url_encode(json.dumps(account_jwk).encode())
            eab_signing_input = f"{eab_protected}.{eab_payload}".encode()

            # The HMAC key is base64url-encoded
            hmac_key = base64.urlsafe_b64decode(eab_hmac_key + "==")
            eab_signature = base64url_encode(
                hmac.new(hmac_key, eab_signing_input, hashlib.sha256).digest()
            )

            payload["externalAccountBinding"] = {
                "protected": eab_protected,
                "payload": eab_payload,
                "signature": eab_signature,
            }

        resp = await self._signed_request(
            self.directory["newAccount"], payload, use_jwk=True
        )

        if resp.status_code not in (200, 201):
            raise AcmeError(f"Account registration failed: {resp.text}")

        self.account_url = resp.headers["Location"]
        return self.account_url

    async def find_account(self) -> str | None:
        if not self.directory:
            await self.fetch_directory()

        payload = {"onlyReturnExisting": True}
        resp = await self._signed_request(
            self.directory["newAccount"], payload, use_jwk=True
        )

        if resp.status_code == 200:
            self.account_url = resp.headers["Location"]
            return self.account_url
        return None

    async def create_order(self, domains: list[str]) -> tuple[str, dict]:
        identifiers = [{"type": "dns", "value": d} for d in domains]
        resp = await self._signed_request(
            self.directory["newOrder"], {"identifiers": identifiers}
        )

        if resp.status_code not in (200, 201):
            raise AcmeError(f"Order creation failed: {resp.text}")

        order_url = resp.headers["Location"]
        return order_url, resp.json()

    async def get_authorization(self, authz_url: str) -> dict:
        resp = await self._signed_request(authz_url, "")
        if resp.status_code != 200:
            raise AcmeError(f"Get authorization failed: {resp.text}")
        return resp.json()

    def get_key_authorization(self, token: str) -> str:
        thumbprint = jwk_thumbprint(self.account_key)
        return f"{token}.{thumbprint}"

    def get_dns_challenge_value(self, key_authorization: str) -> str:
        from cryptography.hazmat.primitives import hashes

        digest = hashes.Hash(hashes.SHA256())
        digest.update(key_authorization.encode())
        return base64url_encode(digest.finalize())

    def select_challenge(self, authz: dict, challenge_type: str) -> dict:
        for challenge in authz["challenges"]:
            if challenge["type"] == challenge_type:
                return challenge
        available = [c["type"] for c in authz["challenges"]]
        raise AcmeError(
            f"Challenge type {challenge_type} not available. Available: {available}"
        )

    async def respond_to_challenge(self, challenge_url: str):
        resp = await self._signed_request(challenge_url, {})
        if resp.status_code not in (200, 202):
            raise AcmeError(f"Challenge response failed: {resp.text}")
        return resp.json()

    async def poll_authorization(
        self, authz_url: str, timeout: int = 120, interval: int = 3
    ) -> dict:
        start = time.time()
        while time.time() - start < timeout:
            authz = await self.get_authorization(authz_url)
            status = authz["status"]
            if status == "valid":
                return authz
            if status in ("invalid", "deactivated", "expired", "revoked"):
                challenge_errors = []
                for c in authz.get("challenges", []):
                    if "error" in c:
                        challenge_errors.append(
                            f"{c['type']}: {c['error'].get('detail', 'unknown')}"
                        )
                error_detail = "; ".join(challenge_errors) if challenge_errors else status
                raise AcmeError(f"Authorization failed: {error_detail}")
            await asyncio.sleep(interval)
        raise AcmeError("Authorization polling timed out")

    async def finalize_order(self, finalize_url: str, csr_der: bytes) -> dict:
        payload = {"csr": base64url_encode(csr_der)}
        resp = await self._signed_request(finalize_url, payload)
        if resp.status_code not in (200, 202):
            raise AcmeError(f"Order finalization failed: {resp.text}")
        return resp.json()

    async def poll_order(
        self, order_url: str, timeout: int = 120, interval: int = 3
    ) -> dict:
        start = time.time()
        while time.time() - start < timeout:
            resp = await self._signed_request(order_url, "")
            order = resp.json()
            if order["status"] == "valid":
                return order
            if order["status"] == "invalid":
                raise AcmeError(f"Order became invalid: {order}")
            await asyncio.sleep(interval)
        raise AcmeError("Order polling timed out")

    async def download_certificate(self, cert_url: str) -> str:
        resp = await self._signed_request(cert_url, "")
        if resp.status_code != 200:
            raise AcmeError(f"Certificate download failed: {resp.text}")
        return resp.text

    async def revoke_certificate(self, cert_pem: str, reason: int = 0):
        """Revoke a certificate via ACME."""
        if not self.directory:
            await self.fetch_directory()

        from cryptography import x509
        from cryptography.hazmat.primitives import serialization

        cert = x509.load_pem_x509_certificate(cert_pem.encode())
        cert_der = cert.public_bytes(serialization.Encoding.DER)

        payload = {
            "certificate": base64url_encode(cert_der),
            "reason": reason,
        }

        resp = await self._signed_request(self.directory["revokeCert"], payload)
        if resp.status_code != 200:
            raise AcmeError(f"Certificate revocation failed: {resp.text}")

        logger.info("Certificate revoked successfully")

    async def request_certificate(
        self,
        domains: list[str],
        challenge_type: str = "dns-01",
        dns_provider=None,
        custom_oids: list[dict] | None = None,
    ) -> tuple[str, str, str]:
        if not self.directory:
            await self.fetch_directory()

        order_url, order = await self.create_order(domains)
        logger.info(f"Created ACME order for {domains}")

        for authz_url in order["authorizations"]:
            authz = await self.get_authorization(authz_url)
            domain = authz["identifier"]["value"]
            challenge = self.select_challenge(authz, challenge_type)
            token = challenge["token"]
            key_auth = self.get_key_authorization(token)

            if challenge_type == "dns-01":
                if dns_provider is None:
                    raise AcmeError("DNS provider required for dns-01 challenge")
                dns_value = self.get_dns_challenge_value(key_auth)
                # Strip wildcard prefix for DNS record name and zone lookup
                clean_domain = domain.lstrip("*.")
                record_name = f"_acme-challenge.{clean_domain}"
                logger.info(f"Creating DNS TXT record: {record_name}")
                await dns_provider.create_txt_record(clean_domain, record_name, dns_value)
                await asyncio.sleep(30)

            await self.respond_to_challenge(challenge["url"])
            await self.poll_authorization(authz_url)
            logger.info(f"Authorization valid for {domain}")

            if challenge_type == "dns-01" and dns_provider:
                try:
                    await dns_provider.delete_txt_record(
                        clean_domain, record_name, dns_value
                    )
                except Exception as e:
                    logger.warning(f"Failed to cleanup DNS record: {e}")

        private_key = generate_rsa_key()
        csr_der = create_csr(private_key, domains, custom_oids=custom_oids)

        await self.finalize_order(order["finalize"], csr_der)
        order = await self.poll_order(order_url)

        full_chain = await self.download_certificate(order["certificate"])

        certs = full_chain.strip().split("-----END CERTIFICATE-----")
        cert_pem = certs[0] + "-----END CERTIFICATE-----\n"
        chain_pem = "-----END CERTIFICATE-----".join(certs[1:]).strip()
        if chain_pem and not chain_pem.endswith("\n"):
            chain_pem += "\n"

        key_pem = serialize_private_key(private_key)

        logger.info(f"Certificate issued for {domains}")
        return key_pem, cert_pem, chain_pem
