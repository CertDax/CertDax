# CertDax — SSL Certificate Management Dashboard

A complete SSL certificate management platform with web dashboard, ACME integration, CA signing, deploy agents, and automated renewal.

![CertDax Dashboard](docs/dashboard.png)

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Quick Start](#quick-start)
  - [Docker Compose](#docker-compose)
  - [Kubernetes / Helm](#kubernetes--helm)
- [Development Setup](#development-setup)
- [First Use](#first-use)
- [Environment Variables](#environment-variables)
- [Linux Deploy Agent](#linux-deploy-agent)
  - [Quick Install](#quick-install)
  - [Manual Installation](#manual-installation)
  - [Usage Without Config File](#usage-without-config-file)
  - [Building From Source](#building-from-source)
- [Windows Deploy Agent](#windows-deploy-agent)
  - [Prerequisites](#prerequisites)
  - [Quick Install — PowerShell One-Liner (Recommended)](#quick-install--powershell-one-liner-recommended)
  - [Manual Installation](#manual-installation-1)
  - [Managing the Service](#managing-the-service)
  - [Alternative Install Methods](#alternative-install-methods)
  - [SmartScreen & Code Signing](#smartscreen--code-signing)
  - [Certificate Deployment Path](#certificate-deployment-path)
- [Kubernetes Operator](#kubernetes-operator)
  - [Installation](#installation)
  - [Deploy an Existing Certificate](#deploy-an-existing-certificate)
  - [Request a Self-Signed Certificate via YAML](#request-a-self-signed-certificate-via-yaml)
  - [Request a CA-Signed Certificate via YAML](#request-a-ca-signed-certificate-via-yaml)
  - [Request an ACME Certificate via YAML](#request-an-acme-certificate-via-yaml)
  - [Request a Self-Signed CA Certificate via YAML](#request-a-self-signed-ca-certificate-via-yaml)
  - [Request Block Fields](#request-block-fields)
- [DNS Provider Configuration](#dns-provider-configuration)
  - [Cloudflare](#cloudflare)
  - [TransIP](#transip)
  - [Hetzner](#hetzner)
  - [DigitalOcean](#digitalocean)
  - [Vultr](#vultr)
  - [OVH](#ovh)
  - [AWS Route 53](#aws-route-53)
  - [Google Cloud DNS](#google-cloud-dns)
  - [Manual](#manual)
- [Reverse Proxy](#reverse-proxy)
  - [Nginx](#nginx)
  - [Apache2](#apache2)
  - [HAProxy](#haproxy)
- [API Endpoints](#api-endpoints)
  - [Self-Signed Certificate API Examples](#self-signed-certificate-api-examples)
- [Scaling (Docker Swarm / Kubernetes)](#scaling-docker-swarm--kubernetes)
  - [Requirements for multi-node](#requirements-for-multi-node)
  - [Docker Swarm example](#docker-swarm-example)
  - [Kubernetes](#kubernetes)
  - [Testing Autoscaling (Podman + Kind)](#testing-autoscaling-podman--kind)
- [Security](#security)

## Features

- **Dashboard** — Overview of all certificates with status, expiry timeline, and statistics
- **ACME Protocol** — Request certificates from Let's Encrypt and other ACME-compatible CAs (DNS-01 and HTTP-01 challenges)
- **Self-Signed & CA Signing** — Generate self-signed certificates, create internal CAs, and sign certificates with your own CA
- **Auto-Renewal** — Automatic certificate renewal with configurable per-certificate thresholds
- **Deploy Agents** — Lightweight Go agents for automated certificate deployment to servers (amd64, arm64, arm, 386)
- **Kubernetes Operator** — Helm-based operator that syncs certificates to TLS secrets, supports Traefik IngressRoute & Nginx Ingress, and can request new certificates directly from YAML CRDs
- **Agent Groups** — Group agents and share certificates across multiple servers
- **DNS Providers** — Cloudflare, TransIP, Hetzner, DigitalOcean, Vultr, OVH, AWS Route 53, Google Cloud DNS, and manual validation
- **Multi-Tenant** — Group-based resource isolation with inter-group sharing
- **SSO / OIDC** — Single sign-on via Authentik, Keycloak, Entra ID, or any OpenID Connect provider with auto-provisioning and admin group mapping
- **Email Notifications** — Customizable HTML email templates for certificate events (expiry, renewal, creation, deletion)
- **API** — Full REST API with API key authentication for scripts, CI/CD, and automation
- **Password Reset** — Secure token-based password recovery via email
- **Security** — Private keys and credentials encrypted at rest, JWT authentication, hashed agent tokens, CORS configuration, Swagger disabled in production

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | React, TypeScript, Tailwind CSS, Recharts |
| **Backend** | Python, FastAPI, SQLAlchemy, cryptography |
| **Database** | PostgreSQL (production) / SQLite (development) |
| **Agent** | Go (statically linked, zero dependencies) |
| **K8s Operator** | Go, controller-runtime, Helm |
| **Infrastructure** | Docker, Docker Compose, Nginx |

## Quick Start

### Docker Compose

```bash
# 1. Clone and configure
cp .env.example .env

# 2. Generate required secrets
python3 -c "import secrets; print('SECRET_KEY=' + secrets.token_urlsafe(64))"
python3 -c "import base64, os; print('ENCRYPTION_KEY=' + base64.urlsafe_b64encode(os.urandom(32)).decode())"
python3 -c "import secrets; print('DB_PASSWORD=' + secrets.token_urlsafe(32))"

# 3. Edit .env with the generated values and your domain
nano .env

# 4. Start the application
docker compose up -d

# 5. Open your browser and create the first admin account
```

### Kubernetes / Helm

Deploy CertDax to any Kubernetes cluster with a single Helm command. The chart includes the backend, frontend, and a PostgreSQL database. An Ingress resource is created automatically so your existing reverse proxy (Nginx, HAProxy, Apache, Traefik, etc.) can reach CertDax immediately.

```bash
# 1. Generate secrets
SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_urlsafe(64))")
ENCRYPTION_KEY=$(python3 -c "import base64,os; print(base64.urlsafe_b64encode(os.urandom(32)).decode())")
DB_PASSWORD=$(python3 -c "import secrets; print(secrets.token_urlsafe(32))")

# 2. Add the Helm repo
helm repo add certdax https://charts.certdax.com
helm repo update

# 3. Install CertDax
helm install certdax certdax/certdax \
  --namespace certdax --create-namespace \
  --set certdax.secretKey="$SECRET_KEY" \
  --set certdax.encryptionKey="$ENCRYPTION_KEY" \
  --set postgresql.auth.password="$DB_PASSWORD" \
  --set ingress.host=certdax.example.com \
  --set ingress.className=nginx

# 4. Open your browser and create the first admin account
```

For TLS, add `--set ingress.tls.enabled=true --set ingress.tls.secretName=certdax-tls` (e.g. via cert-manager or the CertDax operator).

Use an external database instead of the built-in PostgreSQL:

```bash
helm install certdax certdax/certdax \
  --namespace certdax --create-namespace \
  --set certdax.secretKey="$SECRET_KEY" \
  --set certdax.encryptionKey="$ENCRYPTION_KEY" \
  --set postgresql.enabled=false \
  --set certdax.externalDatabaseUrl="postgresql://user:pass@db-host:5432/certdax" \
  --set ingress.host=certdax.example.com
```

## Development Setup

**Backend:**
```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip3 install -r requirements.txt

# Create a .env for development
cat > .env << EOF
SECRET_KEY=$(python -c "import secrets; print(secrets.token_urlsafe(64))")
CORS_ORIGINS=http://localhost:5173
FRONTEND_URL=http://localhost:5173
DEBUG=true
EOF

uvicorn app.main:app --reload --port 8000
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 in your browser.

## First Use

1. Open the application and create the first admin account
2. Go to **Settings** → configure SMTP for email notifications (optional)
3. Go to **Settings** → configure OIDC/SSO for single sign-on (optional)
4. Go to **Providers** and add a DNS provider (e.g. Cloudflare) and/or Certificate Authority
5. Go to **Certificates** → **New certificate** and request your first ACME certificate
6. Go to **Self-Signed** to generate internal certificates or create a CA
7. (Optional) Set up **Agents** and install the deploy agent on your servers — see [Linux](#linux-deploy-agent) or [Windows](#windows-deploy-agent)
8. (Optional) Go to **API** to create API keys for scripting and automation

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SECRET_KEY` | Yes | — | JWT signing key. Must be identical across all replicas |
| `ENCRYPTION_KEY` | Recommended | Auto-generated | Encryption key for private keys and secrets. **Must be identical** across replicas |
| `DB_PASSWORD` | Docker only | — | PostgreSQL password (Docker Compose sets up the database automatically) |
| `DATABASE_URL` | No | `sqlite:///./data/certdax.db` | Database connection string. Use PostgreSQL for production |
| `ACME_CONTACT_EMAIL` | No | `admin@example.com` | Contact email for ACME certificate requests |
| `JWT_EXPIRY_MINUTES` | No | `1440` | JWT token lifetime in minutes |
| `RENEWAL_CHECK_HOURS` | No | `12` | How often to check for certificates needing renewal |
| `RENEWAL_THRESHOLD_DAYS` | No | `30` | Default days before expiry to trigger auto-renewal |
| `CORS_ORIGINS` | Yes | — | Comma-separated list of allowed frontend origins |
| `API_BASE_URL` | No | Auto-detected | Public backend URL (used in agent install scripts) |
| `FRONTEND_URL` | Yes | — | Public frontend URL (used in password reset emails) |
| `AGENT_BINARIES_DIR` | No | `agent-dist` | Directory containing agent binaries |
| `DEBUG` | No | `false` | Enable Swagger/OpenAPI docs at `/docs` and `/redoc` |

## Linux Deploy Agent

The deploy agent is a statically compiled Go binary that runs on any Linux distribution without dependencies. Available for **amd64**, **arm64**, **arm** and **386** architectures. A [Windows agent](#windows-deploy-agent) is also available (see below).

### Quick Install

```bash
# On the target server (as root)
cd agent/
sudo ./install.sh
```

This automatically detects the architecture, copies the binary to `/usr/local/bin/certdax-agent`, creates the config directory and installs the systemd service.

### Manual Installation

```bash
# Choose the correct binary for your architecture
# Options: certdax-agent-linux-amd64, -arm64, -arm, -386
sudo install -m 755 dist/certdax-agent-linux-amd64 /usr/local/bin/certdax-agent

# Create config directory and configure
sudo mkdir -p /etc/certdax
sudo cp config.example.yaml /etc/certdax/config.yaml
sudo chmod 600 /etc/certdax/config.yaml
sudo nano /etc/certdax/config.yaml

# Install systemd service
sudo cp certdax-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now certdax-agent
```

### Usage Without Config File

```bash
certdax-agent --api-url https://certdax.example.com --token YOUR_AGENT_TOKEN

# Or via environment variables
export CERTDAX_API_URL=https://certdax.example.com
export CERTDAX_AGENT_TOKEN=your-token
certdax-agent
```

### Building From Source

```bash
cd agent/

# Build for all platforms
make all

# Or build for current platform only
make build

# Binaries are in dist/
ls -la dist/
```

## Windows Deploy Agent

The Windows agent is the same statically compiled Go binary, packaged for Windows. Available for **x64 (amd64)**, **ARM64**, and **x86 (32-bit)** architectures.

### Prerequisites

- Windows 10 / Windows Server 2016 or later
- PowerShell 5.1 or later (pre-installed on all supported Windows versions)
- An elevated (Administrator) PowerShell session

### Quick Install — PowerShell One-Liner (Recommended)

The easiest way is to use the PowerShell one-liner from the CertDax UI:

1. Go to **Agents** in the CertDax dashboard
2. Click **Add agent** and select **Windows** as the OS type
3. Select a **Self-Signed CA** to code-sign the agent binary (this suppresses SmartScreen warnings)
4. Fill in the agent name and hostname, then click **Create**
5. Click the **Install** button on the newly created agent
6. Copy the PowerShell one-liner and run it in an **elevated PowerShell** session on the target machine

```powershell
# Example (actual command comes from the UI with a pre-embedded token):
iwr -useb "https://certdax.example.com/api/agents/1/install/windows-script?ca_id=1&token=..." | iex
```

The script will:
- Automatically detect the CPU architecture (amd64 / ARM64 / x86)
- Download and verify the signed agent binary
- Install it to `C:\ProgramData\CertDax\certdax-agent.exe`
- Create the configuration file at `C:\ProgramData\CertDax\config.yaml`
- Register and start a **Windows Service** (`CertDaxAgent`) set to start automatically

> **Note:** The NSIS setup wizard (`.exe`) installs the binary to `C:\Program Files\CertDax\` instead.

### Manual Installation

If you prefer to install without running a remote script:

**1. Download the binary**

Download `certdax-agent-windows-amd64.exe` (or `arm64` / `386`) from the CertDax UI:

- Go to **Agents** → your agent → **Install** → *Advanced / scripted install options* → **certdax-agent.exe (signed)**

**2. Place the binary**

```powershell
# Run as Administrator
New-Item -ItemType Directory -Force "C:\ProgramData\CertDax"
Move-Item certdax-agent-windows-amd64.exe "C:\ProgramData\CertDax\certdax-agent.exe"
```

**3. Create the configuration file**

```powershell
New-Item -ItemType Directory -Force "C:\ProgramData\CertDax"

@"
api_url: "https://certdax.example.com"
agent_token: "your-agent-token-here"
poll_interval: 30
"@ | Set-Content "C:\ProgramData\CertDax\config.yaml"
```

The agent token is shown when you create the agent in the UI. You can also retrieve it from **Agents** → your agent → **Token**.

**4. Install as a Windows Service**

```powershell
# Create the service
New-Service -Name "CertDaxAgent" `
            -DisplayName "CertDax Deploy Agent" `
            -Description "Deploys certificates from CertDax to this machine" `
            -BinaryPathName '"C:\ProgramData\CertDax\certdax-agent.exe" --config "C:\ProgramData\CertDax\config.yaml"' `
            -StartupType Automatic

# Start the service
Start-Service CertDaxAgent

# Verify it is running
Get-Service CertDaxAgent
```

### Managing the Service

```powershell
# View service status
Get-Service CertDaxAgent

# Stop / Start / Restart
Stop-Service CertDaxAgent
Start-Service CertDaxAgent
Restart-Service CertDaxAgent

# View recent log output (Windows Event Log)
Get-EventLog -LogName Application -Source CertDaxAgent -Newest 20

# Uninstall
Stop-Service CertDaxAgent
Remove-Service CertDaxAgent           # PowerShell 6+ / Windows Server 2019+
# Or on older systems:
sc.exe delete CertDaxAgent
```

### Alternative Install Methods

| Method | When to use |
|--------|-------------|
| **PowerShell one-liner** | Interactive install on a single machine — recommended |
| **Windows Installer (.exe)** | UI-driven wizard; SmartScreen may warn, right-click → Properties → Unblock if needed |
| **PowerShell script (.ps1)** | Scripted/RMM deployments (e.g. Intune, PDQ, Ansible) |
| **Manual binary** | Air-gapped or policy-restricted environments |

All options are available in the **Install** modal of each agent in the CertDax dashboard.

### SmartScreen & Code Signing

Binaries downloaded through the browser may be blocked by Windows SmartScreen. The recommended workaround is to use the **PowerShell one-liner**, which downloads the binary directly from PowerShell and bypasses the browser mark-of-the-web. Alternatively:

- Install the **signing CA** as a Trusted Root on the target machine before downloading the binary — SmartScreen will then trust it automatically
- Right-click the downloaded `.exe` → **Properties** → **Unblock** → **OK**

### Certificate Deployment Path

By default the agent deploys certificates to:

```
C:\ProgramData\CertDax\certs\
```

You can change this in the **Deploy path** field when creating the agent in the UI, or directly in `config.yaml`.

## Kubernetes Operator

The CertDax Kubernetes Operator runs in your cluster and synchronises certificates from CertDax into standard `kubernetes.io/tls` secrets. It supports Traefik IngressRoute, Nginx Ingress, and any controller that reads TLS secrets.

### Installation

```bash
helm repo add certdax https://charts.certdax.com
helm repo update
helm install certdax-operator certdax/certdax-operator \
  --namespace certdax-system --create-namespace \
  --set certdax.apiUrl=https://certdax.example.com/api \
  --set certdax.apiKey=YOUR_API_KEY
```

### Deploy an Existing Certificate

Reference a certificate that already exists in CertDax by its ID:

```yaml
apiVersion: certdax.com/v1alpha1
kind: CertDaxCertificate
metadata:
  name: webapp-cert
spec:
  certificateId: 42
  type: acme
  secretName: webapp-tls
```

### Request a Self-Signed Certificate via YAML

Omit `certificateId` (or set it to `0`) and add a `request` block. The operator creates the certificate in CertDax and syncs the TLS secret automatically.

```yaml
apiVersion: certdax.com/v1alpha1
kind: CertDaxCertificate
metadata:
  name: my-selfsigned
spec:
  type: selfsigned
  secretName: my-selfsigned-tls
  request:
    commonName: myapp.internal
    sanDomains: "myapp.internal,*.myapp.internal"
    validityDays: 365
    autoRenew: true
```

### Request a CA-Signed Certificate via YAML

Sign the certificate with an existing CA managed in CertDax:

```yaml
apiVersion: certdax.com/v1alpha1
kind: CertDaxCertificate
metadata:
  name: ca-signed-cert
spec:
  type: selfsigned
  secretName: ca-signed-tls
  includeCA: true
  request:
    commonName: api.internal.example.com
    sanDomains: "api.internal.example.com,grpc.internal.example.com"
    caId: 3          # CA certificate ID from CertDax
    validityDays: 90
    autoRenew: true
```

### Request an ACME Certificate via YAML

Request a publicly trusted certificate via Let's Encrypt or another ACME CA:

```yaml
apiVersion: certdax.com/v1alpha1
kind: CertDaxCertificate
metadata:
  name: public-cert
spec:
  type: acme
  secretName: public-tls
  request:
    commonName: www.example.com
    sanDomains: "www.example.com,example.com"
    providerId: 1       # ACME provider ID from CertDax
    dnsProviderId: 1    # DNS provider ID for dns-01 challenge
    autoRenew: true
```

> **Note:** ACME certificates require DNS validation. The operator retries automatically until the certificate is issued.

### Request a Self-Signed CA Certificate via YAML

Create a brand new Certificate Authority from YAML with `isCA: true`. You can then reference this CA's ID in other certificate requests using `caId`.

```yaml
apiVersion: certdax.com/v1alpha1
kind: CertDaxCertificate
metadata:
  name: internal-ca
spec:
  type: selfsigned
  secretName: internal-ca-tls
  includeCA: true
  request:
    commonName: My Internal CA
    isCA: true
    validityDays: 3650
    autoRenew: false
```

> **Tip:** After creation, check `kubectl describe cdxcert internal-ca` to find the assigned `certificateId` in the status. Use that ID as `caId` in other certificate requests.

### Request Block Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `commonName` | string | *required* | Primary domain / CN |
| `sanDomains` | string | `""` | Comma-separated SANs |
| `providerId` | int | — | ACME provider ID (required for `type: acme`) |
| `dnsProviderId` | int | — | DNS provider ID for dns-01 challenge (required for `type: acme`) |
| `caId` | int | — | CA certificate ID (for CA-signed self-signed) |
| `isCA` | bool | `false` | Create a CA certificate instead of a regular certificate |
| `autoRenew` | bool | `true` | Enable automatic renewal |
| `validityDays` | int | `365` | Validity period (self-signed only) |

See the [full documentation](https://certdax.com/docs.html#k8s-overview) for Traefik/Nginx quick starts, TLSStore, dashboard integration, and troubleshooting.

## DNS Provider Configuration

### Cloudflare
```json
{
  "api_token": "your-cloudflare-api-token"
}
```
Create an API token in Cloudflare with `Zone:DNS:Edit` permissions.

### TransIP
```json
{
  "login": "your-transip-login",
  "private_key": "-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
}
```
Generate a key pair in the TransIP control panel.

### Hetzner
```json
{
  "api_token": "your-hetzner-dns-api-token"
}
```
Create an API token in the Hetzner DNS Console.

### DigitalOcean
```json
{
  "api_token": "your-digitalocean-api-token"
}
```
Create a personal access token in the DigitalOcean control panel with read/write scope.

### Vultr
```json
{
  "api_key": "your-vultr-api-key"
}
```
Create an API key in the Vultr customer portal.

### OVH
```json
{
  "endpoint": "ovh-eu",
  "application_key": "your-app-key",
  "application_secret": "your-app-secret",
  "consumer_key": "your-consumer-key"
}
```
Generate credentials at https://api.ovh.com/createToken/.

### AWS Route 53
```json
{
  "access_key_id": "AKIAIOSFODNN7EXAMPLE",
  "secret_access_key": "your-secret-access-key",
  "region": "us-east-1"
}
```
Create an IAM user with `route53:ChangeResourceRecordSets` and `route53:ListHostedZones` permissions.

### Google Cloud DNS
```json
{
  "project_id": "your-gcp-project-id",
  "service_account_json": "{...}"
}
```
Create a service account with the `DNS Administrator` role and export the JSON key.

### Manual
```json
{}
```
With manual validation, DNS records are shown in the server logs.

## Reverse Proxy

By default CertDax listens on port **80** (HTTP). Place a reverse proxy in front for SSL termination. The examples below assume CertDax runs on `127.0.0.1:80`.

### Nginx

```nginx
server {
    listen 443 ssl http2;
    server_name certdax.example.com;

    ssl_certificate     /etc/ssl/certs/certdax.pem;
    ssl_certificate_key /etc/ssl/private/certdax.key;

    location / {
        proxy_pass http://127.0.0.1:80;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        client_max_body_size 10m;
    }
}

server {
    listen 80;
    server_name certdax.example.com;
    return 301 https://$host$request_uri;
}
```

### Apache2

Enable the required modules first:

```bash
sudo a2enmod proxy proxy_http ssl rewrite headers
sudo systemctl restart apache2
```

```apache
<VirtualHost *:443>
    ServerName certdax.example.com

    SSLEngine On
    SSLCertificateFile    /etc/ssl/certs/certdax.pem
    SSLCertificateKeyFile /etc/ssl/private/certdax.key

    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:80/
    ProxyPassReverse / http://127.0.0.1:80/

    RequestHeader set X-Forwarded-Proto "https"
    RequestHeader set X-Forwarded-Port "443"
</VirtualHost>

<VirtualHost *:80>
    ServerName certdax.example.com
    RewriteEngine On
    RewriteRule ^(.*)$ https://%{HTTP_HOST}$1 [R=301,L]
</VirtualHost>
```

### HAProxy

```haproxy
frontend https_in
    bind *:443 ssl crt /etc/haproxy/certs/certdax.pem
    bind *:80
    http-request redirect scheme https unless { ssl_fc }

    default_backend certdax

backend certdax
    option httpchk GET /health
    http-request set-header X-Forwarded-Proto https if { ssl_fc }
    server certdax 127.0.0.1:80 check
```

> **Note:** Set `CORS_ORIGINS` and `FRONTEND_URL` in your `.env` to the public URL (e.g. `https://certdax.example.com`).

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/register` | POST | Create first admin account |
| `/api/auth/login` | POST | Login |
| `/api/certificates` | GET | List ACME certificates |
| `/api/certificates/request` | POST | Request new ACME certificate |
| `/api/certificates/{id}/renew` | POST | Renew ACME certificate |
| `/api/providers/cas` | GET | List Certificate Authorities |
| `/api/providers/dns` | GET/POST | Manage DNS providers |
| `/api/self-signed` | GET | List self-signed certificates (filter: `?is_ca=true`, `?search=`) |
| `/api/self-signed` | POST | Create self-signed or CA-signed certificate |
| `/api/self-signed/{id}` | GET | Get certificate details (incl. PEM) |
| `/api/self-signed/{id}` | DELETE | Delete certificate (`?force=true` to force) |
| `/api/self-signed/{id}/renew` | POST | Renew certificate (`?validity_days=365`) |
| `/api/self-signed/{id}/parsed` | GET | Parsed X.509 certificate details |
| `/api/self-signed/{id}/download/zip` | GET | Download cert + key as ZIP |
| `/api/self-signed/{id}/download/pem/{type}` | GET | Download PEM (type: `certificate`, `privatekey`, `combined`, `chain`, `ca`) |
| `/api/self-signed/{id}/download/pfx` | GET | Download as PFX/PKCS#12 |
| `/api/agents` | GET/POST | Manage deploy agents |
| `/api/agent-groups` | GET/POST | Manage agent groups |
| `/api/agent/poll` | GET | Agent: fetch pending deployments |
| `/api/agent/heartbeat` | POST | Agent: heartbeat |

### Self-Signed Certificate API Examples

**Create a self-signed certificate:**

```bash
curl -X POST https://certdax.example.com/api/self-signed \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "common_name": "myserver.local",
    "san_domains": ["*.myserver.local"],
    "organization": "MyCompany",
    "country": "NL",
    "key_type": "rsa",
    "key_size": 4096,
    "validity_days": 365
  }'
```

**Create a CA certificate:**

```bash
curl -X POST https://certdax.example.com/api/self-signed \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "common_name": "My Internal CA",
    "organization": "MyCompany",
    "country": "NL",
    "key_type": "rsa",
    "key_size": 4096,
    "validity_days": 3650,
    "is_ca": true
  }'
```

**Sign a certificate with an existing CA:**

```bash
curl -X POST https://certdax.example.com/api/self-signed \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "common_name": "app.internal",
    "san_domains": ["app.internal", "api.internal"],
    "organization": "MyCompany",
    "key_type": "rsa",
    "key_size": 4096,
    "validity_days": 365,
    "ca_id": 1
  }'
```

> **Note:** Set `ca_id` to the ID of a certificate created with `is_ca: true`. The certificate will be signed by that CA instead of being self-signed. The CA chain is automatically included in ZIP and PFX downloads.

## Scaling (Docker Swarm / Kubernetes)

CertDax supports horizontal scaling with multiple backend replicas. The following mechanisms ensure cluster safety:

- **Distributed locking** — Scheduled tasks (renewal checks, expiry checks) use database-backed locks so only one instance executes them at a time
- **Atomic status transitions** — Certificate processing uses atomic database updates to prevent race conditions between replicas
- **Stateless API** — JWT authentication is stateless; any replica can serve any request
- **PostgreSQL required** — SQLite only supports single-node; use PostgreSQL for multi-node

### Requirements for multi-node

| Setting | Why |
|---------|-----|
| `ENCRYPTION_KEY` | **Must be identical** across all replicas. Without it, each node generates its own key and encrypted data becomes unreadable across nodes |
| `SECRET_KEY` | Must be identical across all replicas for JWT validation |
| `DATABASE_URL` | Must point to a shared PostgreSQL instance |
| Agent binaries | Built into the Docker image (`backend/agent-dist/`). Copy them from `agent/dist/` before building |

### Docker Swarm example

```bash
# Build and push images
docker compose build
docker tag certdax-backend registry.example.com/certdax-backend:latest
docker tag certdax-frontend registry.example.com/certdax-frontend:latest
docker push registry.example.com/certdax-backend:latest
docker push registry.example.com/certdax-frontend:latest

# Deploy as a stack (scales backend replicas)
docker stack deploy -c docker-compose.yml certdax
docker service scale certdax_backend=3
```

### Kubernetes

The recommended way to deploy CertDax on Kubernetes is with the **Helm chart** — see [Quick Start (Kubernetes / Helm)](#quick-start-kubernetes--helm). The chart handles secrets, PostgreSQL, Ingress, and multi-replica backends automatically.

Alternatively, use the Docker images with a standard deployment. Key points:
- Store `SECRET_KEY`, `ENCRYPTION_KEY`, `DB_PASSWORD` in a K8s Secret
- Use a `Deployment` with multiple replicas for the backend
- Point `DATABASE_URL` to a managed PostgreSQL (e.g. CloudSQL, RDS, or an in-cluster instance)
- Copy agent binaries into `backend/agent-dist/` before building the image

### Testing Autoscaling (Podman + Kind)

The Helm chart includes optional `HorizontalPodAutoscaler` resources for the backend and frontend. Enable them with `backend.autoscaling.enabled=true` and/or `frontend.autoscaling.enabled=true`. You can test autoscaling locally using **Podman** as the container runtime for a **Kind** cluster.

**Prerequisites:** `podman`, `kind`, `kubectl`, `helm`

#### 1. Create a Kind cluster on Podman

```bash
KIND_EXPERIMENTAL_PROVIDER=podman kind create cluster --name certdax-test
```

#### 2. Install metrics-server (required for HPA)

```bash
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml

# Patch for Kind (no real TLS certs)
kubectl patch deployment metrics-server -n kube-system \
  --type=json \
  -p='[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'
```

#### 3. Install CertDax with autoscaling enabled

```bash
helm repo add certdax https://charts.certdax.com
helm repo update

helm install certdax certdax/certdax \
  --namespace certdax --create-namespace \
  --set certdax.secretKey="$(python3 -c 'import secrets; print(secrets.token_urlsafe(64))')" \
  --set certdax.encryptionKey="$(python3 -c 'import base64,os; print(base64.urlsafe_b64encode(os.urandom(32)).decode())')" \
  --set postgresql.auth.password="testpassword123" \
  --set backend.autoscaling.enabled=true \
  --set backend.autoscaling.targetCPUUtilizationPercentage=50 \
  --set frontend.autoscaling.enabled=true \
  --set ingress.enabled=false
```

#### 4. Verify HPA is running

```bash
kubectl get hpa -n certdax
# Wait ~60s for metrics-server to start reporting, then watch:
kubectl get hpa -n certdax -w
```

#### 5. Generate load to trigger scaling

```bash
# In another terminal, generate traffic against the backend
kubectl run -n certdax load-gen --rm -i --tty \
  --image=busybox -- /bin/sh -c \
  "while true; do wget -q -O- http://certdax-backend:8000/health; done"
```

Watch the HPA scale up with `kubectl get hpa -n certdax -w`. You should see `TARGETS` rise and `REPLICAS` increase.

#### 6. Cleanup

```bash
KIND_EXPERIMENTAL_PROVIDER=podman kind delete cluster --name certdax-test
```

## Security

| Mechanism | Details |
|-----------|---------|
| **Private key encryption** | Fernet (AES-128-CBC + HMAC) at rest |
| **Credential encryption** | DNS provider and OIDC secrets encrypted at rest |
| **Password hashing** | bcrypt |
| **Agent tokens** | SHA-256 hashed |
| **API keys** | SHA-256 hashed, 25 keys per user limit |
| **Authentication** | JWT tokens (configurable expiry) + API key fallback |
| **CORS** | Configurable per environment |
| **OpenAPI/Swagger** | Disabled in production |
| **Container** | Non-root user for backend |
| **Cluster safety** | Database-backed distributed locking for scheduled tasks |
