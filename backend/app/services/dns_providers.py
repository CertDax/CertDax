import abc
import logging

import httpx

logger = logging.getLogger(__name__)


class DnsProviderBase(abc.ABC):
    @abc.abstractmethod
    async def create_txt_record(self, domain: str, name: str, value: str):
        pass

    @abc.abstractmethod
    async def delete_txt_record(self, domain: str, name: str, value: str):
        pass


class ManualDnsProvider(DnsProviderBase):
    async def create_txt_record(self, domain: str, name: str, value: str):
        logger.info(
            f"[MANUAL] Please create DNS TXT record:\n"
            f"  Name:  {name}\n"
            f"  Value: {value}\n"
            f"  Then wait for propagation."
        )

    async def delete_txt_record(self, domain: str, name: str, value: str):
        logger.info(f"[MANUAL] You can now remove the TXT record: {name}")


class CloudflareDnsProvider(DnsProviderBase):
    def __init__(self, api_token: str):
        self.api_token = api_token
        self.base_url = "https://api.cloudflare.com/client/v4"
        self.client = httpx.AsyncClient(
            timeout=30.0,
            headers={"Authorization": f"Bearer {self.api_token}"},
        )
        self._record_ids: dict[str, str] = {}

    async def _get_zone_id(self, domain: str) -> str:
        parts = domain.split(".")
        for i in range(len(parts) - 1):
            zone_name = ".".join(parts[i:])
            resp = await self.client.get(
                f"{self.base_url}/zones", params={"name": zone_name}
            )
            data = resp.json()
            if data.get("result"):
                return data["result"][0]["id"]
        raise RuntimeError(f"Could not find Cloudflare zone for {domain}")

    async def create_txt_record(self, domain: str, name: str, value: str):
        zone_id = await self._get_zone_id(domain)

        # Delete any existing TXT records with the same name first
        existing = await self.client.get(
            f"{self.base_url}/zones/{zone_id}/dns_records",
            params={"type": "TXT", "name": name},
        )
        existing_data = existing.json()
        for rec in existing_data.get("result", []):
            await self.client.delete(
                f"{self.base_url}/zones/{zone_id}/dns_records/{rec['id']}"
            )
            logger.info(f"Deleted existing Cloudflare TXT record: {name} (id={rec['id']})")

        resp = await self.client.post(
            f"{self.base_url}/zones/{zone_id}/dns_records",
            json={"type": "TXT", "name": name, "content": value, "ttl": 60},
        )
        data = resp.json()
        if not data.get("success"):
            raise RuntimeError(f"Cloudflare DNS create failed: {data.get('errors')}")
        self._record_ids[f"{name}:{value}"] = data["result"]["id"]
        logger.info(f"Created Cloudflare TXT record: {name}")

    async def delete_txt_record(self, domain: str, name: str, value: str):
        record_id = self._record_ids.get(f"{name}:{value}")
        if not record_id:
            return
        zone_id = await self._get_zone_id(domain)
        await self.client.delete(
            f"{self.base_url}/zones/{zone_id}/dns_records/{record_id}"
        )
        logger.info(f"Deleted Cloudflare TXT record: {name}")


class TransIPDnsProvider(DnsProviderBase):
    def __init__(self, login: str, private_key: str):
        self.login = login
        self.private_key = private_key
        self.base_url = "https://api.transip.nl/v6"
        self._token: str | None = None
        self.client = httpx.AsyncClient(timeout=30.0)

    async def _get_token(self) -> str:
        if self._token:
            return self._token

        import json
        import time
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import padding
        from app.utils.crypto import base64url_encode

        key = serialization.load_pem_private_key(
            self.private_key.encode(), password=None
        )

        body = json.dumps(
            {
                "login": self.login,
                "nonce": str(int(time.time())),
                "read_only": False,
                "expiration_time": "30 minutes",
                "label": "certdax",
                "global_key": True,
            }
        )

        signature = key.sign(body.encode(), padding.PKCS1v15(), hashes.SHA512())

        resp = await self.client.post(
            f"{self.base_url}/auth",
            content=body,
            headers={
                "Content-Type": "application/json",
                "Signature": base64url_encode(signature),
            },
        )
        data = resp.json()
        self._token = data["token"]
        return self._token

    def _get_zone_and_record(self, name: str) -> tuple[str, str]:
        parts = name.split(".")
        if len(parts) >= 3:
            zone = ".".join(parts[-2:])
            record = ".".join(parts[:-2])
        else:
            zone = name
            record = "@"
        return zone, record

    async def create_txt_record(self, domain: str, name: str, value: str):
        token = await self._get_token()
        zone, record_name = self._get_zone_and_record(name)

        resp = await self.client.get(
            f"{self.base_url}/domains/{zone}/dns",
            headers={"Authorization": f"Bearer {token}"},
        )
        current_entries = resp.json().get("dnsEntries", [])

        current_entries.append(
            {"name": record_name, "expire": 60, "type": "TXT", "content": value}
        )

        resp = await self.client.put(
            f"{self.base_url}/domains/{zone}/dns",
            json={"dnsEntries": current_entries},
            headers={"Authorization": f"Bearer {token}"},
        )
        if resp.status_code not in (200, 204):
            raise RuntimeError(f"TransIP DNS update failed: {resp.text}")
        logger.info(f"Created TransIP TXT record: {name}")

    async def delete_txt_record(self, domain: str, name: str, value: str):
        token = await self._get_token()
        zone, record_name = self._get_zone_and_record(name)

        resp = await self.client.delete(
            f"{self.base_url}/domains/{zone}/dns",
            json={
                "dnsEntry": {
                    "name": record_name,
                    "expire": 60,
                    "type": "TXT",
                    "content": value,
                }
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        logger.info(f"Deleted TransIP TXT record: {name}")


class HetznerDnsProvider(DnsProviderBase):
    """Hetzner DNS API — requires an API token from https://dns.hetzner.com/settings/api-token"""

    def __init__(self, api_token: str):
        self.api_token = api_token
        self.base_url = "https://dns.hetzner.com/api/v1"
        self.client = httpx.AsyncClient(
            timeout=30.0,
            headers={"Auth-API-Token": self.api_token},
        )
        self._record_ids: dict[str, str] = {}

    async def _get_zone_id(self, domain: str) -> str:
        parts = domain.split(".")
        for i in range(len(parts) - 1):
            zone_name = ".".join(parts[i:])
            resp = await self.client.get(
                f"{self.base_url}/zones", params={"name": zone_name}
            )
            data = resp.json()
            for z in data.get("zones", []):
                if z["name"] == zone_name:
                    return z["id"]
        raise RuntimeError(f"Could not find Hetzner DNS zone for {domain}")

    async def create_txt_record(self, domain: str, name: str, value: str):
        zone_id = await self._get_zone_id(domain)
        # name relative to zone
        zone_resp = await self.client.get(f"{self.base_url}/zones/{zone_id}")
        zone_name = zone_resp.json()["zone"]["name"]
        record_name = name[: -(len(zone_name) + 1)] if name.endswith(f".{zone_name}") else name

        resp = await self.client.post(
            f"{self.base_url}/records",
            json={
                "zone_id": zone_id,
                "type": "TXT",
                "name": record_name,
                "value": value,
                "ttl": 60,
            },
        )
        data = resp.json()
        if "record" not in data:
            raise RuntimeError(f"Hetzner DNS create failed: {data}")
        self._record_ids[f"{name}:{value}"] = data["record"]["id"]
        logger.info(f"Created Hetzner TXT record: {name}")

    async def delete_txt_record(self, domain: str, name: str, value: str):
        record_id = self._record_ids.get(f"{name}:{value}")
        if not record_id:
            return
        await self.client.delete(f"{self.base_url}/records/{record_id}")
        logger.info(f"Deleted Hetzner TXT record: {name}")


class DigitalOceanDnsProvider(DnsProviderBase):
    """DigitalOcean DNS API — requires a personal access token."""

    def __init__(self, api_token: str):
        self.api_token = api_token
        self.base_url = "https://api.digitalocean.com/v2"
        self.client = httpx.AsyncClient(
            timeout=30.0,
            headers={"Authorization": f"Bearer {self.api_token}"},
        )
        self._record_ids: dict[str, int] = {}

    def _get_zone_and_record(self, name: str) -> tuple[str, str]:
        parts = name.split(".")
        if len(parts) >= 3:
            zone = ".".join(parts[-2:])
            record = ".".join(parts[:-2])
        else:
            zone = name
            record = "@"
        return zone, record

    async def create_txt_record(self, domain: str, name: str, value: str):
        zone, record_name = self._get_zone_and_record(name)
        resp = await self.client.post(
            f"{self.base_url}/domains/{zone}/records",
            json={"type": "TXT", "name": record_name, "data": value, "ttl": 60},
        )
        data = resp.json()
        if "domain_record" not in data:
            raise RuntimeError(f"DigitalOcean DNS create failed: {data}")
        self._record_ids[f"{name}:{value}"] = data["domain_record"]["id"]
        logger.info(f"Created DigitalOcean TXT record: {name}")

    async def delete_txt_record(self, domain: str, name: str, value: str):
        record_id = self._record_ids.get(f"{name}:{value}")
        if not record_id:
            return
        zone, _ = self._get_zone_and_record(name)
        await self.client.delete(
            f"{self.base_url}/domains/{zone}/records/{record_id}"
        )
        logger.info(f"Deleted DigitalOcean TXT record: {name}")


class VultrDnsProvider(DnsProviderBase):
    """Vultr DNS API v2 — requires an API key from https://my.vultr.com/settings/#settingsapi"""

    def __init__(self, api_key: str):
        self.api_key = api_key
        self.base_url = "https://api.vultr.com/v2"
        self.client = httpx.AsyncClient(
            timeout=30.0,
            headers={"Authorization": f"Bearer {self.api_key}"},
        )
        self._record_ids: dict[str, str] = {}

    def _get_zone_and_record(self, name: str) -> tuple[str, str]:
        parts = name.split(".")
        if len(parts) >= 3:
            zone = ".".join(parts[-2:])
            record = ".".join(parts[:-2])
        else:
            zone = name
            record = ""
        return zone, record

    async def create_txt_record(self, domain: str, name: str, value: str):
        zone, record_name = self._get_zone_and_record(name)
        resp = await self.client.post(
            f"{self.base_url}/domains/{zone}/records",
            json={"type": "TXT", "name": record_name, "data": f'"{value}"', "ttl": 60},
        )
        data = resp.json()
        if "record" not in data:
            raise RuntimeError(f"Vultr DNS create failed: {data}")
        self._record_ids[f"{name}:{value}"] = data["record"]["id"]
        logger.info(f"Created Vultr TXT record: {name}")

    async def delete_txt_record(self, domain: str, name: str, value: str):
        record_id = self._record_ids.get(f"{name}:{value}")
        if not record_id:
            return
        zone, _ = self._get_zone_and_record(name)
        await self.client.delete(
            f"{self.base_url}/domains/{zone}/records/{record_id}"
        )
        logger.info(f"Deleted Vultr TXT record: {name}")


class OvhDnsProvider(DnsProviderBase):
    """OVH DNS API — requires application_key, application_secret, consumer_key.

    See https://api.ovh.com/createToken/ to generate these.
    """

    def __init__(
        self,
        endpoint: str,
        application_key: str,
        application_secret: str,
        consumer_key: str,
    ):
        self.application_key = application_key
        self.application_secret = application_secret
        self.consumer_key = consumer_key
        endpoints = {
            "ovh-eu": "https://eu.api.ovh.com/1.0",
            "ovh-ca": "https://ca.api.ovh.com/1.0",
            "ovh-us": "https://api.us.ovhcloud.com/1.0",
        }
        self.base_url = endpoints.get(endpoint, endpoints["ovh-eu"])
        self.client = httpx.AsyncClient(timeout=30.0)
        self._record_ids: dict[str, int] = {}

    async def _request(self, method: str, path: str, body: str = "") -> httpx.Response:
        import hashlib
        import time

        now = str(int(time.time()))
        url = f"{self.base_url}{path}"
        sig_data = f"{self.application_secret}+{self.consumer_key}+{method.upper()}+{url}+{body}+{now}"
        signature = "$1$" + hashlib.sha1(sig_data.encode()).hexdigest()

        headers = {
            "X-Ovh-Application": self.application_key,
            "X-Ovh-Consumer": self.consumer_key,
            "X-Ovh-Timestamp": now,
            "X-Ovh-Signature": signature,
            "Content-Type": "application/json",
        }
        return await self.client.request(method, url, content=body, headers=headers)

    def _get_zone_and_subdomain(self, name: str) -> tuple[str, str]:
        parts = name.split(".")
        if len(parts) >= 3:
            zone = ".".join(parts[-2:])
            sub = ".".join(parts[:-2])
        else:
            zone = name
            sub = ""
        return zone, sub

    async def create_txt_record(self, domain: str, name: str, value: str):
        import json as _json

        zone, sub = self._get_zone_and_subdomain(name)
        body = _json.dumps(
            {"fieldType": "TXT", "subDomain": sub, "target": value, "ttl": 60}
        )
        resp = await self._request("POST", f"/domain/zone/{zone}/record", body)
        data = resp.json()
        if "id" not in data:
            raise RuntimeError(f"OVH DNS create failed: {data}")
        self._record_ids[f"{name}:{value}"] = data["id"]
        # Refresh zone
        await self._request("POST", f"/domain/zone/{zone}/refresh")
        logger.info(f"Created OVH TXT record: {name}")

    async def delete_txt_record(self, domain: str, name: str, value: str):
        record_id = self._record_ids.get(f"{name}:{value}")
        if not record_id:
            return
        zone, _ = self._get_zone_and_subdomain(name)
        await self._request("DELETE", f"/domain/zone/{zone}/record/{record_id}")
        await self._request("POST", f"/domain/zone/{zone}/refresh")
        logger.info(f"Deleted OVH TXT record: {name}")


class Route53DnsProvider(DnsProviderBase):
    """AWS Route53 DNS — requires access_key_id and secret_access_key."""

    def __init__(self, access_key_id: str, secret_access_key: str, region: str = "us-east-1"):
        self.access_key_id = access_key_id
        self.secret_access_key = secret_access_key
        self.region = region
        self.base_url = "https://route53.amazonaws.com/2013-04-01"
        self.client = httpx.AsyncClient(timeout=30.0)

    async def _get_hosted_zone_id(self, domain: str) -> str:
        import hmac
        import hashlib
        from datetime import datetime, timezone

        now = datetime.now(timezone.utc).strftime("%a, %d %b %Y %H:%M:%S GMT")
        sig = hmac.new(
            self.secret_access_key.encode(), now.encode(), hashlib.sha256
        ).digest()

        import base64

        signature = base64.b64encode(sig).decode()

        headers = {
            "X-Amz-Date": now,
            "Authorization": f"AWS3-HTTPS AWSAccessKeyId={self.access_key_id},Algorithm=HmacSHA256,Signature={signature}",
        }

        parts = domain.split(".")
        for i in range(len(parts) - 1):
            zone_name = ".".join(parts[i:]) + "."
            resp = await self.client.get(
                f"{self.base_url}/hostedzonesbyname",
                params={"dnsname": zone_name, "maxitems": "1"},
                headers=headers,
            )
            # Parse XML
            import xml.etree.ElementTree as ET

            root = ET.fromstring(resp.text)
            ns = {"r53": "https://route53.amazonaws.com/doc/2013-04-01/"}
            for hz in root.findall(".//r53:HostedZone", ns):
                hz_name = hz.findtext("r53:Name", "", ns)
                if hz_name == zone_name:
                    return hz.findtext("r53:Id", "", ns).replace("/hostedzone/", "")
        raise RuntimeError(f"Could not find Route53 hosted zone for {domain}")

    async def _change_record(self, action: str, domain: str, name: str, value: str):
        import hmac
        import hashlib
        import base64
        from datetime import datetime, timezone

        zone_id = await self._get_hosted_zone_id(domain)

        now = datetime.now(timezone.utc).strftime("%a, %d %b %Y %H:%M:%S GMT")
        sig = hmac.new(
            self.secret_access_key.encode(), now.encode(), hashlib.sha256
        ).digest()
        signature = base64.b64encode(sig).decode()

        headers = {
            "X-Amz-Date": now,
            "Authorization": f"AWS3-HTTPS AWSAccessKeyId={self.access_key_id},Algorithm=HmacSHA256,Signature={signature}",
            "Content-Type": "application/xml",
        }

        body = f"""<?xml version="1.0" encoding="UTF-8"?>
<ChangeResourceRecordSetsRequest xmlns="https://route53.amazonaws.com/doc/2013-04-01/">
  <ChangeBatch>
    <Changes>
      <Change>
        <Action>{action}</Action>
        <ResourceRecordSet>
          <Name>{name}</Name>
          <Type>TXT</Type>
          <TTL>60</TTL>
          <ResourceRecords>
            <ResourceRecord>
              <Value>"{value}"</Value>
            </ResourceRecord>
          </ResourceRecords>
        </ResourceRecordSet>
      </Change>
    </Changes>
  </ChangeBatch>
</ChangeResourceRecordSetsRequest>"""

        resp = await self.client.post(
            f"{self.base_url}/hostedzone/{zone_id}/rrset",
            content=body,
            headers=headers,
        )
        if resp.status_code >= 400:
            raise RuntimeError(f"Route53 DNS {action} failed: {resp.text}")

    async def create_txt_record(self, domain: str, name: str, value: str):
        await self._change_record("UPSERT", domain, name, value)
        logger.info(f"Created Route53 TXT record: {name}")

    async def delete_txt_record(self, domain: str, name: str, value: str):
        try:
            await self._change_record("DELETE", domain, name, value)
            logger.info(f"Deleted Route53 TXT record: {name}")
        except Exception:
            logger.warning(f"Failed to delete Route53 TXT record: {name}")


class GoogleCloudDnsProvider(DnsProviderBase):
    """Google Cloud DNS — requires project_id and a service account JSON key."""

    def __init__(self, project_id: str, service_account_json: str):
        import json as _json

        self.project_id = project_id
        self.sa_info = _json.loads(service_account_json) if isinstance(service_account_json, str) else service_account_json
        self.base_url = "https://dns.googleapis.com/dns/v1"
        self.client = httpx.AsyncClient(timeout=30.0)
        self._token: str | None = None
        self._token_expires: float = 0

    async def _get_access_token(self) -> str:
        import json as _json
        import time

        now = time.time()
        if self._token and now < self._token_expires - 60:
            return self._token

        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import padding
        import base64

        header = base64.urlsafe_b64encode(
            _json.dumps({"alg": "RS256", "typ": "JWT"}).encode()
        ).rstrip(b"=")

        iat = int(now)
        exp = iat + 3600
        claims = _json.dumps(
            {
                "iss": self.sa_info["client_email"],
                "scope": "https://www.googleapis.com/auth/ndev.clouddns.readwrite",
                "aud": "https://oauth2.googleapis.com/token",
                "iat": iat,
                "exp": exp,
            }
        )
        payload = base64.urlsafe_b64encode(claims.encode()).rstrip(b"=")
        signing_input = header + b"." + payload

        key = serialization.load_pem_private_key(
            self.sa_info["private_key"].encode(), password=None
        )
        signature = key.sign(signing_input, padding.PKCS1v15(), hashes.SHA256())
        sig_b64 = base64.urlsafe_b64encode(signature).rstrip(b"=")

        jwt = (signing_input + b"." + sig_b64).decode()

        resp = await self.client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                "assertion": jwt,
            },
        )
        data = resp.json()
        self._token = data["access_token"]
        self._token_expires = now + data.get("expires_in", 3600)
        return self._token

    async def _get_managed_zone(self, domain: str) -> str:
        token = await self._get_access_token()
        resp = await self.client.get(
            f"{self.base_url}/projects/{self.project_id}/managedZones",
            headers={"Authorization": f"Bearer {token}"},
        )
        data = resp.json()
        parts = domain.split(".")
        for i in range(len(parts) - 1):
            zone_dns = ".".join(parts[i:]) + "."
            for mz in data.get("managedZones", []):
                if mz["dnsName"] == zone_dns:
                    return mz["name"]
        raise RuntimeError(f"Could not find Google Cloud DNS zone for {domain}")

    async def create_txt_record(self, domain: str, name: str, value: str):
        token = await self._get_access_token()
        zone_name = await self._get_managed_zone(domain)
        fqdn = name if name.endswith(".") else name + "."

        resp = await self.client.post(
            f"{self.base_url}/projects/{self.project_id}/managedZones/{zone_name}/changes",
            json={
                "additions": [
                    {
                        "name": fqdn,
                        "type": "TXT",
                        "ttl": 60,
                        "rrdatas": [f'"{value}"'],
                    }
                ]
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        if resp.status_code >= 400:
            raise RuntimeError(f"Google Cloud DNS create failed: {resp.text}")
        logger.info(f"Created Google Cloud DNS TXT record: {name}")

    async def delete_txt_record(self, domain: str, name: str, value: str):
        token = await self._get_access_token()
        zone_name = await self._get_managed_zone(domain)
        fqdn = name if name.endswith(".") else name + "."

        try:
            resp = await self.client.post(
                f"{self.base_url}/projects/{self.project_id}/managedZones/{zone_name}/changes",
                json={
                    "deletions": [
                        {
                            "name": fqdn,
                            "type": "TXT",
                            "ttl": 60,
                            "rrdatas": [f'"{value}"'],
                        }
                    ]
                },
                headers={"Authorization": f"Bearer {token}"},
            )
            logger.info(f"Deleted Google Cloud DNS TXT record: {name}")
        except Exception:
            logger.warning(f"Failed to delete Google Cloud DNS TXT record: {name}")


def get_dns_provider(provider_type: str, credentials: dict) -> DnsProviderBase:
    if provider_type == "cloudflare":
        return CloudflareDnsProvider(api_token=credentials["api_token"])
    elif provider_type == "transip":
        return TransIPDnsProvider(
            login=credentials["login"], private_key=credentials["private_key"]
        )
    elif provider_type == "hetzner":
        return HetznerDnsProvider(api_token=credentials["api_token"])
    elif provider_type == "digitalocean":
        return DigitalOceanDnsProvider(api_token=credentials["api_token"])
    elif provider_type == "vultr":
        return VultrDnsProvider(api_key=credentials["api_key"])
    elif provider_type == "ovh":
        return OvhDnsProvider(
            endpoint=credentials.get("endpoint", "ovh-eu"),
            application_key=credentials["application_key"],
            application_secret=credentials["application_secret"],
            consumer_key=credentials["consumer_key"],
        )
    elif provider_type == "route53":
        return Route53DnsProvider(
            access_key_id=credentials["access_key_id"],
            secret_access_key=credentials["secret_access_key"],
        )
    elif provider_type == "gcloud":
        return GoogleCloudDnsProvider(
            project_id=credentials["project_id"],
            service_account_json=credentials["service_account_json"],
        )
    elif provider_type == "manual":
        return ManualDnsProvider()
    else:
        raise ValueError(f"Unsupported DNS provider type: {provider_type}")
