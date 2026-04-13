// Package certdax provides an HTTP client for the CertDax backend API.
package certdax

import (
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
