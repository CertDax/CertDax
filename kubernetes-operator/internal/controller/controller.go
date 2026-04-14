// Package controller implements the Kubernetes reconciler for CertDaxCertificate resources.
package controller

import (
	"context"
	stderrors "errors"
	"fmt"
	"time"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/log"

	certdaxv1alpha1 "github.com/certdax/kubernetes-operator/api/v1alpha1"
	certdaxclient "github.com/certdax/kubernetes-operator/internal/certdax"
)

// CertDaxCertificateReconciler reconciles a CertDaxCertificate object.
type CertDaxCertificateReconciler struct {
	client.Client
	Scheme       *runtime.Scheme
	CertDaxAPI   *certdaxclient.Client
	DefaultSync  time.Duration
}

// Reconcile fetches the certificate from CertDax and creates/updates the TLS secret.
func (r *CertDaxCertificateReconciler) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
	logger := log.FromContext(ctx)

	// Fetch the CertDaxCertificate resource
	var certCR certdaxv1alpha1.CertDaxCertificate
	if err := r.Get(ctx, req.NamespacedName, &certCR); err != nil {
		if errors.IsNotFound(err) {
			return ctrl.Result{}, nil
		}
		return ctrl.Result{}, err
	}

	// Determine sync interval
	syncInterval := r.DefaultSync
	if certCR.Spec.SyncInterval != "" {
		if d, err := time.ParseDuration(certCR.Spec.SyncInterval); err == nil {
			syncInterval = d
		}
	}

	// ---- Certificate request flow ----
	// If certificateId is 0 and a request block is provided, ask the backend
	// to create a new certificate first.
	certID := certCR.Spec.CertificateID
	if certID == 0 && certCR.Status.CertificateID != 0 {
		// Already requested in a previous reconcile; use the stored ID.
		certID = certCR.Status.CertificateID
	}
	// Fallback: check annotation in case status was lost
	if certID == 0 {
		if ann, ok := certCR.Annotations["certdax.com/certificate-id"]; ok {
			if parsed, err := fmt.Sscanf(ann, "%d", &certID); err == nil && parsed == 1 && certID > 0 {
				logger.Info("Recovered certificateId from annotation", "name", certCR.Name, "certificateId", certID)
			}
		}
	}

	if certID == 0 {
		if certCR.Spec.Request == nil {
			r.updateStatus(ctx, &certCR, false, "certificateId is 0 and no request block provided", "", "")
			logger.Info("Nothing to do: no certificateId and no request block", "name", certCR.Name)
			return ctrl.Result{}, nil
		}

		logger.Info("Requesting new certificate via CertDax API",
			"name", certCR.Name,
			"commonName", certCR.Spec.Request.CommonName,
			"type", certCR.Spec.Type,
		)

		payload := &certdaxclient.CertificateRequestPayload{
			CommonName:   certCR.Spec.Request.CommonName,
			SANDomains:   certCR.Spec.Request.SANDomains,
			Type:         certCR.Spec.Type,
			ProviderID:   certCR.Spec.Request.ProviderID,
			CaID:         certCR.Spec.Request.CaID,
			IsCA:         certCR.Spec.Request.IsCA,
			AutoRenew:    certCR.Spec.Request.AutoRenew,
			ValidityDays: certCR.Spec.Request.ValidityDays,
		}

		resp, err := r.CertDaxAPI.RequestCertificate(payload)
		if err != nil {
			r.updateStatus(ctx, &certCR, false, fmt.Sprintf("Failed to request certificate: %v", err), "", "")
			logger.Error(err, "Failed to request certificate from CertDax")
			return ctrl.Result{RequeueAfter: syncInterval}, nil
		}

		certID = resp.ID
		logger.Info("Certificate requested successfully",
			"name", certCR.Name,
			"newCertificateId", certID,
			"status", resp.Status,
		)

		// Persist the assigned ID via annotation (survives status conflicts)
		latest := &certdaxv1alpha1.CertDaxCertificate{}
		if err := r.Get(ctx, req.NamespacedName, latest); err != nil {
			logger.Error(err, "Failed to re-fetch CR after certificate request")
			return ctrl.Result{RequeueAfter: 5 * time.Second}, nil
		}
		if latest.Annotations == nil {
			latest.Annotations = make(map[string]string)
		}
		latest.Annotations["certdax.com/certificate-id"] = fmt.Sprintf("%d", certID)
		if err := r.Update(ctx, latest); err != nil {
			logger.Error(err, "Failed to save certificate-id annotation")
			return ctrl.Result{RequeueAfter: 5 * time.Second}, nil
		}

		// Now update status
		if err := r.Get(ctx, req.NamespacedName, latest); err == nil {
			latest.Status.CertificateID = certID
			latest.Status.Message = fmt.Sprintf("Certificate requested (id=%d), waiting for issuance", certID)
			if err := r.Status().Update(ctx, latest); err != nil {
				logger.Error(err, "Failed to update status with certificate ID, will recover from annotation")
			}
		}

		// For ACME certs the cert won't be ready immediately; requeue.
		if resp.Status != "issued" {
			return ctrl.Result{RequeueAfter: 30 * time.Second}, nil
		}
	}

	logger.Info("Reconciling CertDaxCertificate",
		"name", certCR.Name,
		"certificateId", certID,
		"type", certCR.Spec.Type,
	)

	// Fetch certificate from CertDax API
	certResp, err := r.CertDaxAPI.FetchCertificate(certCR.Spec.Type, certID)
	if err != nil {
		if stderrors.Is(err, certdaxclient.ErrNotYetIssued) {
			r.updateStatus(ctx, &certCR, false, "Waiting for certificate to be issued", "", "")
			logger.Info("Certificate not yet issued, will retry", "name", certCR.Name, "certificateId", certCR.Spec.CertificateID)
			return ctrl.Result{RequeueAfter: syncInterval}, nil
		}
		if stderrors.Is(err, certdaxclient.ErrNotFound) {
			r.updateStatus(ctx, &certCR, false, "Certificate not found in CertDax (deleted?)", "", "")
			logger.Info("Certificate not found (404), stopping reconcile", "name", certCR.Name, "certificateId", certID)
			return ctrl.Result{}, nil
		}
		r.updateStatus(ctx, &certCR, false, fmt.Sprintf("Failed to fetch certificate: %v", err), "", "")
		logger.Error(err, "Failed to fetch certificate from CertDax")
		return ctrl.Result{RequeueAfter: syncInterval}, nil
	}

	// Determine target namespace
	secretNamespace := certCR.Namespace
	if certCR.Spec.SecretNamespace != "" {
		secretNamespace = certCR.Spec.SecretNamespace
	}

	// Build the TLS secret
	secret := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:      certCR.Spec.SecretName,
			Namespace: secretNamespace,
		},
	}

	// Check if the secret already exists
	existingSecret := &corev1.Secret{}
	err = r.Get(ctx, types.NamespacedName{Name: secret.Name, Namespace: secret.Namespace}, existingSecret)
	secretExists := err == nil

	// Prepare secret data
	secret.Type = corev1.SecretTypeTLS
	secret.Data = map[string][]byte{
		corev1.TLSCertKey:       []byte(certResp.CertificatePEM),
		corev1.TLSPrivateKeyKey: []byte(certResp.PrivateKeyPEM),
	}

	// Add CA certificate if available and requested
	if certCR.Spec.IncludeCA && certResp.ChainPEM != "" {
		secret.Data["ca.crt"] = []byte(certResp.ChainPEM)
	}

	// Apply labels
	secret.Labels = map[string]string{
		"app.kubernetes.io/managed-by": "certdax-operator",
		"certdax.com/certificate-id":   fmt.Sprintf("%d", certID),
		"certdax.com/certificate-type": certCR.Spec.Type,
	}
	for k, v := range certCR.Spec.SecretLabels {
		secret.Labels[k] = v
	}

	// Apply annotations
	secret.Annotations = map[string]string{
		"certdax.com/common-name": certResp.CommonName,
		"certdax.com/expires-at":  certResp.ExpiresAt,
		"certdax.com/synced-at":   time.Now().UTC().Format(time.RFC3339),
	}
	for k, v := range certCR.Spec.SecretAnnotations {
		secret.Annotations[k] = v
	}

	// Set owner reference only if secret is in the same namespace
	if secretNamespace == certCR.Namespace {
		secret.OwnerReferences = []metav1.OwnerReference{
			*metav1.NewControllerRef(&certCR, certdaxv1alpha1.GroupVersion.WithKind("CertDaxCertificate")),
		}
	}

	// Create or update the secret
	if secretExists {
		existingSecret.Type = secret.Type
		existingSecret.Data = secret.Data
		existingSecret.Labels = secret.Labels
		existingSecret.Annotations = secret.Annotations
		if secretNamespace == certCR.Namespace {
			existingSecret.OwnerReferences = secret.OwnerReferences
		}
		if err := r.Update(ctx, existingSecret); err != nil {
			r.updateStatus(ctx, &certCR, false, fmt.Sprintf("Failed to update secret: %v", err), certResp.CommonName, certResp.ExpiresAt)
			return ctrl.Result{RequeueAfter: syncInterval}, err
		}
		logger.Info("Updated TLS secret", "secret", secret.Name, "namespace", secret.Namespace)
	} else {
		if err := r.Create(ctx, secret); err != nil {
			r.updateStatus(ctx, &certCR, false, fmt.Sprintf("Failed to create secret: %v", err), certResp.CommonName, certResp.ExpiresAt)
			return ctrl.Result{RequeueAfter: syncInterval}, err
		}
		logger.Info("Created TLS secret", "secret", secret.Name, "namespace", secret.Namespace)
	}

	// Update status
	r.updateStatus(ctx, &certCR, true, "Certificate synced successfully", certResp.CommonName, certResp.ExpiresAt)

	return ctrl.Result{RequeueAfter: syncInterval}, nil
}

func (r *CertDaxCertificateReconciler) updateStatus(
	ctx context.Context,
	certCR *certdaxv1alpha1.CertDaxCertificate,
	ready bool,
	message, commonName, expiresAt string,
) {
	// Re-fetch the latest version to avoid conflict errors
	latest := &certdaxv1alpha1.CertDaxCertificate{}
	if err := r.Get(ctx, types.NamespacedName{Name: certCR.Name, Namespace: certCR.Namespace}, latest); err != nil {
		log.FromContext(ctx).Error(err, "Failed to re-fetch CertDaxCertificate for status update")
		return
	}

	latest.Status.Ready = ready
	latest.Status.Message = message
	latest.Status.LastSyncedAt = time.Now().UTC().Format(time.RFC3339)
	if commonName != "" {
		latest.Status.CommonName = commonName
	}
	if expiresAt != "" {
		latest.Status.ExpiresAt = expiresAt
	}
	latest.Status.SecretName = certCR.Spec.SecretName

	conditionType := "Ready"
	conditionStatus := metav1.ConditionFalse
	if ready {
		conditionStatus = metav1.ConditionTrue
	}

	// Update or add condition
	found := false
	for i, c := range latest.Status.Conditions {
		if c.Type == conditionType {
			latest.Status.Conditions[i].Status = conditionStatus
			latest.Status.Conditions[i].Message = message
			latest.Status.Conditions[i].LastTransitionTime = metav1.Now()
			latest.Status.Conditions[i].Reason = "Reconciled"
			found = true
			break
		}
	}
	if !found {
		latest.Status.Conditions = append(latest.Status.Conditions, metav1.Condition{
			Type:               conditionType,
			Status:             conditionStatus,
			Message:            message,
			Reason:             "Reconciled",
			LastTransitionTime: metav1.Now(),
		})
	}

	if err := r.Status().Update(ctx, latest); err != nil {
		log.FromContext(ctx).Error(err, "Failed to update CertDaxCertificate status")
	}
}

// SetupWithManager sets up the controller with the Manager.
func (r *CertDaxCertificateReconciler) SetupWithManager(mgr ctrl.Manager) error {
	return ctrl.NewControllerManagedBy(mgr).
		For(&certdaxv1alpha1.CertDaxCertificate{}).
		Owns(&corev1.Secret{}).
		Complete(r)
}
