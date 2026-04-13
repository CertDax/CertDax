# CertDax Kubernetes Operator

A Kubernetes operator that syncs certificates from CertDax to Kubernetes TLS secrets — similar to cert-manager, but backed by your CertDax instance.

## How It Works

```
┌──────────────┐     CRD watch      ┌───────────────────┐    API call    ┌─────────────┐
│  Kubernetes  │ ◄────────────────── │  CertDax Operator │ ─────────────► │   CertDax   │
│  TLS Secret  │   create/update     │   (controller)    │  fetch cert    │   Backend   │
└──────┬───────┘                     └───────────────────┘                └─────────────┘
       │
       │ references
       ▼
┌──────────────┐
│   Traefik /  │
│ nginx-ingress│
│   / other    │
└──────────────┘
```

1. You create a `CertDaxCertificate` custom resource specifying the certificate ID
2. The operator fetches the certificate from the CertDax API
3. A standard Kubernetes TLS secret is created/updated
4. Traefik, nginx-ingress, or any other ingress controller uses the secret
5. The operator periodically re-syncs to pick up renewals automatically

## Installation

### Prerequisites

- Kubernetes 1.24+
- Helm 3.x
- A CertDax instance with an API key

### Install via Helm

```bash
# Add the Helm repo (when published)
helm repo add certdax https://charts.certdax.com
helm repo update

# Or install from local chart
helm install certdax-operator ./helm/certdax-operator \
  --namespace certdax-system \
  --create-namespace \
  --set certdax.apiUrl=https://certdax.example.com \
  --set certdax.apiKey=your-api-key-here
```

### Using an Existing Secret

If you prefer not to pass the API key via Helm values:

```bash
# Create the secret manually
kubectl create secret generic certdax-api-credentials \
  --namespace certdax-system \
  --from-literal=api-key=your-api-key-here

# Install with existing secret reference
helm install certdax-operator ./helm/certdax-operator \
  --namespace certdax-system \
  --create-namespace \
  --set certdax.apiUrl=https://certdax.example.com \
  --set certdax.existingSecret=certdax-api-credentials
```

## Usage

### Basic: Self-Signed Certificate

```yaml
apiVersion: certdax.com/v1alpha1
kind: CertDaxCertificate
metadata:
  name: my-app-cert
  namespace: default
spec:
  certificateId: 42
  type: selfsigned
  secretName: my-app-tls
```

### ACME Certificate

```yaml
apiVersion: certdax.com/v1alpha1
kind: CertDaxCertificate
metadata:
  name: my-acme-cert
  namespace: default
spec:
  certificateId: 15
  type: acme
  secretName: my-acme-tls
  syncInterval: "30m"
```

### With Traefik IngressRoute

```yaml
apiVersion: certdax.com/v1alpha1
kind: CertDaxCertificate
metadata:
  name: webapp-cert
  namespace: default
spec:
  certificateId: 42
  type: selfsigned
  secretName: webapp-tls
  syncInterval: "1h"
---
apiVersion: traefik.io/v1alpha1
kind: IngressRoute
metadata:
  name: webapp
  namespace: default
spec:
  entryPoints:
    - websecure
  routes:
    - match: Host(`webapp.example.com`)
      kind: Rule
      services:
        - name: webapp
          port: 80
  tls:
    secretName: webapp-tls
```

### With Standard Ingress (nginx/Traefik)

```yaml
apiVersion: certdax.com/v1alpha1
kind: CertDaxCertificate
metadata:
  name: api-cert
  namespace: default
spec:
  certificateId: 10
  type: acme
  secretName: api-tls
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: api-ingress
  namespace: default
spec:
  tls:
    - hosts:
        - api.example.com
      secretName: api-tls
  rules:
    - host: api.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: api-service
                port:
                  number: 80
```

### With Traefik TLSStore (Default Certificate)

```yaml
apiVersion: certdax.com/v1alpha1
kind: CertDaxCertificate
metadata:
  name: default-cert
  namespace: traefik
spec:
  certificateId: 1
  type: selfsigned
  secretName: default-tls
  includeCA: true
---
apiVersion: traefik.io/v1alpha1
kind: TLSStore
metadata:
  name: default
  namespace: traefik
spec:
  defaultCertificate:
    secretName: default-tls
```

### CA Certificate with Custom Labels

```yaml
apiVersion: certdax.com/v1alpha1
kind: CertDaxCertificate
metadata:
  name: internal-ca
  namespace: cert-store
spec:
  certificateId: 5
  type: selfsigned
  secretName: internal-ca-tls
  includeCA: true
  secretLabels:
    environment: production
    team: platform
  secretAnnotations:
    description: "Internal CA for service mesh"
```

## CRD Reference

### Spec Fields

| Field              | Type              | Default      | Description                                                |
|--------------------|-------------------|--------------|------------------------------------------------------------|
| `certificateId`    | int               | *required*   | Certificate ID in CertDax                                  |
| `type`             | string            | `selfsigned` | Certificate type: `selfsigned` or `acme`                   |
| `secretName`       | string            | *required*   | Name of the TLS secret to create                           |
| `secretNamespace`  | string            | CR namespace | Override namespace for the secret                          |
| `syncInterval`     | string            | `1h`         | Re-sync interval (Go duration: `30m`, `1h`, `24h`)        |
| `includeCA`        | bool              | `true`       | Include CA cert in `ca.crt` field of the secret            |
| `secretLabels`     | map[string]string | `{}`         | Additional labels for the TLS secret                       |
| `secretAnnotations`| map[string]string | `{}`         | Additional annotations for the TLS secret                  |

### Status Fields

| Field          | Description                              |
|----------------|------------------------------------------|
| `ready`        | Whether the TLS secret is up to date     |
| `secretName`   | Name of the managed TLS secret           |
| `commonName`   | CN from the certificate                  |
| `expiresAt`    | Certificate expiry (ISO 8601)            |
| `lastSyncedAt` | Last successful sync time                |
| `message`      | Human-readable status message            |
| `conditions`   | Standard Kubernetes conditions           |

### kubectl Examples

```bash
# List all CertDax certificates
kubectl get certdaxcertificates
kubectl get cdxcert  # short name

# Check status
kubectl describe cdxcert my-app-cert

# Watch for changes
kubectl get cdxcert -w

# Example output:
# NAME           TYPE         SECRET        READY   CN                EXPIRES                    AGE
# my-app-cert    selfsigned   my-app-tls    true    *.example.com     2027-04-13T00:00:00Z       5m
# my-acme-cert   acme         my-acme-tls   true    api.example.com   2026-07-12T00:00:00Z       2m
```

## Configuration

### Helm Values

| Value                       | Default                                    | Description                          |
|-----------------------------|--------------------------------------------|--------------------------------------|
| `certdax.apiUrl`            | `""`                                       | CertDax backend URL (required)       |
| `certdax.apiKey`            | `""`                                       | API key for authentication           |
| `certdax.existingSecret`    | `""`                                       | Existing K8s secret with `api-key`   |
| `certdax.syncInterval`      | `"1h"`                                     | Default sync interval                |
| `watchNamespace`            | `""`                                       | Restrict to single namespace         |
| `image.repository`          | `ghcr.io/certdax/certdax-k8s-operator`     | Operator image                       |
| `image.tag`                 | `latest`                                   | Image tag                            |

## Building

```bash
# Build binary
make build

# Build Docker image
make docker

# Run tests
make test
```

## Architecture

The operator uses [controller-runtime](https://github.com/kubernetes-sigs/controller-runtime) and follows the standard Kubernetes operator pattern:

- **CRD** (`CertDaxCertificate`): Declarative desired state
- **Controller**: Watches CRDs, reconciles by fetching from CertDax API
- **TLS Secret**: Standard `kubernetes.io/tls` secret compatible with all ingress controllers
- **Owner References**: Secrets are garbage-collected when the CR is deleted (same-namespace only)

The operator communicates with CertDax via the `/api/k8s/certificate/{type}/{id}` endpoints using API key authentication.
