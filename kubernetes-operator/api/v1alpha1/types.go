package v1alpha1

import (
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// CertDaxCertificateSpec defines the desired state of CertDaxCertificate.
type CertDaxCertificateSpec struct {
	// CertificateID is the ID of the certificate in CertDax.
	// +kubebuilder:validation:Required
	CertificateID int `json:"certificateId"`

	// Type is the certificate type: "selfsigned" or "acme".
	// +kubebuilder:validation:Enum=selfsigned;acme
	// +kubebuilder:default=selfsigned
	Type string `json:"type"`

	// SecretName is the name of the Kubernetes TLS secret to create/update.
	// +kubebuilder:validation:Required
	SecretName string `json:"secretName"`

	// SecretNamespace overrides the namespace for the TLS secret.
	// Defaults to the namespace of the CertDaxCertificate resource.
	// +optional
	SecretNamespace string `json:"secretNamespace,omitempty"`

	// SyncInterval is how often to check for certificate updates (e.g. "1h", "30m").
	// Defaults to "1h".
	// +optional
	// +kubebuilder:default="1h"
	SyncInterval string `json:"syncInterval,omitempty"`

	// IncludeCA includes the CA certificate in the secret's ca.crt field.
	// +optional
	// +kubebuilder:default=true
	IncludeCA bool `json:"includeCA,omitempty"`

	// SecretLabels are additional labels to apply to the created TLS secret.
	// +optional
	SecretLabels map[string]string `json:"secretLabels,omitempty"`

	// SecretAnnotations are additional annotations to apply to the created TLS secret.
	// +optional
	SecretAnnotations map[string]string `json:"secretAnnotations,omitempty"`
}

// CertDaxCertificateStatus defines the observed state of CertDaxCertificate.
type CertDaxCertificateStatus struct {
	// Ready indicates whether the TLS secret has been successfully created.
	Ready bool `json:"ready"`

	// SecretName is the name of the created TLS secret.
	// +optional
	SecretName string `json:"secretName,omitempty"`

	// CommonName is the common name from the certificate.
	// +optional
	CommonName string `json:"commonName,omitempty"`

	// ExpiresAt is the certificate expiry timestamp.
	// +optional
	ExpiresAt string `json:"expiresAt,omitempty"`

	// LastSyncedAt is the last time the certificate was synced.
	// +optional
	LastSyncedAt string `json:"lastSyncedAt,omitempty"`

	// Message contains a human-readable status message.
	// +optional
	Message string `json:"message,omitempty"`

	// Conditions represent the latest available observations.
	// +optional
	Conditions []metav1.Condition `json:"conditions,omitempty"`
}

// +kubebuilder:object:root=true
// +kubebuilder:subresource:status
// +kubebuilder:printcolumn:name="Type",type=string,JSONPath=`.spec.type`
// +kubebuilder:printcolumn:name="Secret",type=string,JSONPath=`.spec.secretName`
// +kubebuilder:printcolumn:name="Ready",type=boolean,JSONPath=`.status.ready`
// +kubebuilder:printcolumn:name="Expires",type=string,JSONPath=`.status.expiresAt`
// +kubebuilder:printcolumn:name="Age",type=date,JSONPath=`.metadata.creationTimestamp`

// CertDaxCertificate is the Schema for the certdaxcertificates API.
type CertDaxCertificate struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`

	Spec   CertDaxCertificateSpec   `json:"spec,omitempty"`
	Status CertDaxCertificateStatus `json:"status,omitempty"`
}

// +kubebuilder:object:root=true

// CertDaxCertificateList contains a list of CertDaxCertificate.
type CertDaxCertificateList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []CertDaxCertificate `json:"items"`
}
