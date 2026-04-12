# CertDax - SSL Certificate Management Dashboard

A complete SSL certificate management system with web dashboard, ACME integration, and automated deployment.

## Features

- **Dashboard** — Overview of all certificates with status, expiry dates and statistics
- **ACME Protocol** — Automatically request certificates from Let's Encrypt and other ACME-compatible CAs
- **DNS Providers** — Support for Cloudflare, TransIP, Hetzner, DigitalOcean, Vultr, OVH, AWS Route 53, Google Cloud DNS and manual DNS validation
- **Auto-renewal** — Automatically renew certificates before they expire
- **Deploy Agent** — Lightweight agent for automated deployment to servers
- **Self-signed** — Generate self-signed certificates for internal use
- **Agent Groups** — Group agents and share certificates across servers
- **Email Notifications** — Customizable email templates for certificate events
- **SSO / OIDC** — Single sign-on via OpenID Connect providers
- **API** — Full REST API with key-based authentication
- **Secure** — Private keys encrypted at rest, JWT authentication, hashed agent tokens

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌──────────────────┐
│   Frontend   │────▶│   Backend   │────▶│  ACME Servers    │
│  (React)     │     │  (FastAPI)  │     │  (Let's Encrypt) │
└─────────────┘     └──────┬──────┘     └──────────────────┘
                           │
                    ┌──────┴──────┐
                    │  Database   │
                    │ SQLite/PG   │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │  Agent   │ │  Agent   │ │  Agent   │
        │ Server 1 │ │ Server 2 │ │ Server 3 │
        └──────────┘ └──────────┘ └──────────┘
```

## Quick Start (Docker Compose)

```bash
# 1. Clone and configure
cp .env.example .env

# 2. Generate required secrets
python -c "import secrets; print('SECRET_KEY=' + secrets.token_urlsafe(64))"
python -c "import base64, os; print('ENCRYPTION_KEY=' + base64.urlsafe_b64encode(os.urandom(32)).decode())"
python -c "import secrets; print('DB_PASSWORD=' + secrets.token_urlsafe(32))"

# 3. Edit .env with the generated values and your domain
nano .env

# 4. Start the application
docker compose up -d

# 5. Open your browser and create the first admin account
```

## Development Setup

**Backend:**
```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

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

1. Open the application and create an admin account
2. Go to **Providers** and configure a DNS provider (e.g. Cloudflare)
3. Go to **Certificates** → **New certificate** and request your first certificate
4. (Optional) Set up **Agents** and install the deploy agent on your servers

## Deploy Agent

The deploy agent is a statically compiled Go binary that runs on any Linux distribution without dependencies. Available for **amd64**, **arm64**, **arm** and **386** architectures.

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

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/register` | POST | Create first admin account |
| `/api/auth/login` | POST | Login |
| `/api/certificates` | GET | List certificates |
| `/api/certificates/request` | POST | Request new certificate |
| `/api/certificates/{id}/renew` | POST | Renew certificate |
| `/api/providers/cas` | GET | List Certificate Authorities |
| `/api/providers/dns` | GET/POST | Manage DNS providers |
| `/api/agents` | GET/POST | Manage deploy agents |
| `/api/agent/poll` | GET | Agent: fetch pending deployments |
| `/api/agent/heartbeat` | POST | Agent: heartbeat |

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

Use the Docker images with a standard deployment. Key points:
- Store `SECRET_KEY`, `ENCRYPTION_KEY`, `DB_PASSWORD` in a K8s Secret
- Use a `Deployment` with multiple replicas for the backend
- Point `DATABASE_URL` to a managed PostgreSQL (e.g. CloudSQL, RDS, or an in-cluster instance)
- Copy agent binaries into `backend/agent-dist/` before building the image

## Tech Stack

- **Backend**: Python, FastAPI, SQLAlchemy, cryptography
- **Frontend**: React, TypeScript, Tailwind CSS, Recharts
- **Agent**: Go (statically linked binary, no dependencies)
- **Infrastructure**: Docker, Docker Compose, Nginx, PostgreSQL

## Security

- Private keys encrypted at rest with Fernet (AES-128-CBC + HMAC)
- User passwords hashed with bcrypt
- Agent tokens hashed with SHA-256
- JWT tokens for web authentication
- API key authentication for programmatic access
- CORS configurable per environment
- Swagger/OpenAPI docs disabled in production
- Non-root container user for backend
- Distributed locking for cluster-safe scheduled tasks
