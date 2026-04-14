// Package certdax provides an HTTP client for the CertDax backend API.
package certdax

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// CertificateResponse is the JSON payload returned by the /api/k8s/certificate endpoints.
type CertificateResponse struct {
	ID             int    `json:"id"`
	CommonName     string `json:"common_name"`
	CertificatePEM string `json:"certificate_pem"`
	PrivateKeyPEM  string `json:"private_key_pem"`
	ChainPEM       string `json:"chain_pem,omitempty"`
	IsCA           bool   `json:"is_ca,omitempty"`
	IssuedAt       string `json:"issued_at,omitempty"`
	ExpiresAt      string `json:"expires_at,omitempty"`
}

// Client communicates with the CertDax backend.
type Client struct {
	BaseURL    string
	APIKey     string
	HTTPClient *http.Client
}

// NewClient creates a new CertDax API client.
func NewClient(baseURL, apiKey string) *Client {
	return &Client{
		BaseURL: baseURL,
		APIKey:  apiKey,
		HTTPClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// ErrNotYetIssued is returned when the certificate exists but has not been issued yet.
var ErrNotYetIssued = fmt.Errorf("certificate is not yet issued")

// FetchCertificate retrieves certificate material from CertDax.
// certType must be "selfsigned" or "acme".
func (c *Client) FetchCertificate(certType string, certID int) (*CertificateResponse, error) {
	url := fmt.Sprintf("%s/k8s/certificate/%s/%d", c.BaseURL, certType, certID)

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("creating request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.APIKey)
	req.Header.Set("Accept", "application/json")

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("requesting certificate: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("reading response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		if resp.StatusCode == http.StatusBadRequest && strings.Contains(string(body), "not yet issued") {
			return nil, ErrNotYetIssued
		}
		return nil, fmt.Errorf("API returned %d: %s", resp.StatusCode, string(body))
	}

	var certResp CertificateResponse
	if err := json.Unmarshal(body, &certResp); err != nil {
		return nil, fmt.Errorf("decoding response: %w", err)
	}

	return &certResp, nil
}

// ManagedCert describes a single CertDaxCertificate CR managed by the operator.
type ManagedCert struct {
	CertificateID int      `json:"certificate_id"`
	Type          string   `json:"type"`
	SecretName    string   `json:"secret_name"`
	Namespace     string   `json:"namespace"`
	CommonName    string   `json:"common_name,omitempty"`
	Ready         bool     `json:"ready"`
	ExpiresAt     string   `json:"expires_at,omitempty"`
	LastSyncedAt  string   `json:"last_synced_at,omitempty"`
	Message       string   `json:"message,omitempty"`
	Ingresses     []string `json:"ingresses,omitempty"`
}

// HeartbeatPayload is sent periodically to the CertDax backend.
type HeartbeatPayload struct {
	Namespace           string        `json:"namespace,omitempty"`
	DeploymentName      string        `json:"deployment_name,omitempty"`
	ClusterName         string        `json:"cluster_name,omitempty"`
	OperatorVersion     string        `json:"operator_version,omitempty"`
	KubernetesVersion   string        `json:"kubernetes_version,omitempty"`
	PodName             string        `json:"pod_name,omitempty"`
	NodeName            string        `json:"node_name,omitempty"`
	CPUUsage            string        `json:"cpu_usage,omitempty"`
	MemoryUsage         string        `json:"memory_usage,omitempty"`
	MemoryLimit         string        `json:"memory_limit,omitempty"`
	ManagedCertificates int           `json:"managed_certificates"`
	ReadyCertificates   int           `json:"ready_certificates"`
	FailedCertificates  int           `json:"failed_certificates"`
	Certificates        []ManagedCert `json:"certificates,omitempty"`
	LastError           string        `json:"last_error,omitempty"`
	RecentLogs          []string      `json:"recent_logs,omitempty"`
}

// DesiredCertificate represents a certificate deployment requested via the dashboard.
type DesiredCertificate struct {
	ID            int    `json:"id"`
	CertificateID int    `json:"certificate_id"`
	Type          string `json:"type"`
	SecretName    string `json:"secret_name"`
	Namespace     string `json:"namespace"`
	SyncInterval  string `json:"sync_interval"`
	IncludeCA     bool   `json:"include_ca"`
}

// HeartbeatResponse is the JSON response from the heartbeat endpoint.
type HeartbeatResponse struct {
	Status              string               `json:"status"`
	DesiredCertificates []DesiredCertificate  `json:"desired_certificates,omitempty"`
}

// SendHeartbeat sends operator status to the CertDax backend.
// Returns the response containing any desired certificate deployments.
func (c *Client) SendHeartbeat(payload *HeartbeatPayload) (*HeartbeatResponse, error) {
	url := fmt.Sprintf("%s/k8s-operator/heartbeat", c.BaseURL)

	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshalling heartbeat: %w", err)
	}

	req, err := http.NewRequest("POST", url, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("creating heartbeat request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.APIKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("sending heartbeat: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("reading heartbeat response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("heartbeat returned %d: %s", resp.StatusCode, string(respBody))
	}

	var hbResp HeartbeatResponse
	if err := json.Unmarshal(respBody, &hbResp); err != nil {
		// Non-fatal: older backends may not return the new format
		return &HeartbeatResponse{Status: "ok"}, nil
	}

	return &hbResp, nil
}

// CertificateRequestPayload is sent to POST /k8s/certificates/request.
type CertificateRequestPayload struct {
	CommonName   string `json:"common_name"`
	SANDomains   string `json:"san_domains,omitempty"`
	Type         string `json:"type"`
	ProviderID   int    `json:"provider_id,omitempty"`
	CaID         int    `json:"ca_id,omitempty"`
	AutoRenew    bool   `json:"auto_renew"`
	ValidityDays int    `json:"validity_days,omitempty"`
}

// CertificateRequestResponse is the JSON response from the request endpoint.
type CertificateRequestResponse struct {
	ID     int    `json:"id"`
	Type   string `json:"type"`
	Status string `json:"status"`
}

// RequestCertificate asks the CertDax backend to create a new certificate
// and returns the assigned certificate ID.
func (c *Client) RequestCertificate(payload *CertificateRequestPayload) (*CertificateRequestResponse, error) {
	url := fmt.Sprintf("%s/k8s/certificates/request", c.BaseURL)

	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshalling certificate request: %w", err)
	}

	req, err := http.NewRequest("POST", url, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("creating certificate request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.APIKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("sending certificate request: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("reading certificate request response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("certificate request returned %d: %s", resp.StatusCode, string(respBody))
	}

	var result CertificateRequestResponse
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("decoding certificate request response: %w", err)
	}

	return &result, nil
}
