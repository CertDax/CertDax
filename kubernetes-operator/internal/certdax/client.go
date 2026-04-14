// Package certdax provides an HTTP client for the CertDax backend API.
package certdax

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
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

// FetchCertificate retrieves certificate material from CertDax.
// certType must be "selfsigned" or "acme".
func (c *Client) FetchCertificate(certType string, certID int) (*CertificateResponse, error) {
	url := fmt.Sprintf("%s/api/k8s/certificate/%s/%d", c.BaseURL, certType, certID)

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
		return nil, fmt.Errorf("API returned %d: %s", resp.StatusCode, string(body))
	}

	var certResp CertificateResponse
	if err := json.Unmarshal(body, &certResp); err != nil {
		return nil, fmt.Errorf("decoding response: %w", err)
	}

	return &certResp, nil
}

// HeartbeatPayload is sent periodically to the CertDax backend.
type HeartbeatPayload struct {
	Namespace           string `json:"namespace,omitempty"`
	DeploymentName      string `json:"deployment_name,omitempty"`
	ClusterName         string `json:"cluster_name,omitempty"`
	OperatorVersion     string `json:"operator_version,omitempty"`
	KubernetesVersion   string `json:"kubernetes_version,omitempty"`
	PodName             string `json:"pod_name,omitempty"`
	NodeName            string `json:"node_name,omitempty"`
	CPUUsage            string `json:"cpu_usage,omitempty"`
	MemoryUsage         string `json:"memory_usage,omitempty"`
	MemoryLimit         string `json:"memory_limit,omitempty"`
	ManagedCertificates int    `json:"managed_certificates"`
	ReadyCertificates   int    `json:"ready_certificates"`
	FailedCertificates  int    `json:"failed_certificates"`
	LastError           string `json:"last_error,omitempty"`
}

// SendHeartbeat sends operator status to the CertDax backend.
func (c *Client) SendHeartbeat(payload *HeartbeatPayload) error {
	url := fmt.Sprintf("%s/k8s-operator/heartbeat", c.BaseURL)

	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshalling heartbeat: %w", err)
	}

	req, err := http.NewRequest("POST", url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("creating heartbeat request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.APIKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("sending heartbeat: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("heartbeat returned %d: %s", resp.StatusCode, string(respBody))
	}

	return nil
}
