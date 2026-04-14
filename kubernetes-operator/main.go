package main

import (
	"context"
	"fmt"
	"os"
	"runtime"
	"strconv"
	"syscall"
	"time"

	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	k8sruntime "k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	utilruntime "k8s.io/apimachinery/pkg/util/runtime"
	clientgoscheme "k8s.io/client-go/kubernetes/scheme"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/cache"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/healthz"
	"sigs.k8s.io/controller-runtime/pkg/log/zap"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"

	"k8s.io/client-go/discovery"

	"github.com/go-logr/logr"
	uzap "go.uber.org/zap"
	"go.uber.org/zap/zapcore"

	certdaxv1alpha1 "github.com/certdax/kubernetes-operator/api/v1alpha1"
	"github.com/certdax/kubernetes-operator/internal/certdax"
	"github.com/certdax/kubernetes-operator/internal/controller"
	"github.com/certdax/kubernetes-operator/internal/logbuffer"
)

const version = "1.0.0"

var scheme = k8sruntime.NewScheme()

func init() {
	utilruntime.Must(clientgoscheme.AddToScheme(scheme))
	utilruntime.Must(certdaxv1alpha1.AddToScheme(scheme))
}

func main() {
	// Setup logger with ring buffer to capture recent logs
	logBuf := logbuffer.New(200)
	opts := zap.Options{Development: false}
	ctrl.SetLogger(zap.New(zap.UseFlagOptions(&opts), zap.RawZapOpts(uzap.WrapCore(func(core zapcore.Core) zapcore.Core {
		return zapcore.NewTee(core, logBuf.ZapCore(zapcore.InfoLevel))
	}))))

	setupLog := ctrl.Log.WithName("setup")

	// Configuration from environment
	apiURL := os.Getenv("CERTDAX_API_URL")
	if apiURL == "" {
		setupLog.Error(fmt.Errorf("CERTDAX_API_URL not set"), "CertDax API URL is required")
		os.Exit(1)
	}

	apiKey := os.Getenv("CERTDAX_API_KEY")
	if apiKey == "" {
		setupLog.Error(fmt.Errorf("CERTDAX_API_KEY not set"), "CertDax API key is required")
		os.Exit(1)
	}

	syncIntervalStr := os.Getenv("CERTDAX_SYNC_INTERVAL")
	defaultSync := 1 * time.Hour
	if syncIntervalStr != "" {
		if d, err := time.ParseDuration(syncIntervalStr); err == nil {
			defaultSync = d
		}
	}

	namespace := os.Getenv("WATCH_NAMESPACE")

	// Create manager
	mgrOptions := ctrl.Options{
		Scheme:                 scheme,
		HealthProbeBindAddress: ":8081",
	}
	if namespace != "" {
		// Watch a single namespace if configured
		mgrOptions.Cache.DefaultNamespaces = map[string]cache.Config{namespace: {}}
	}

	mgr, err := ctrl.NewManager(ctrl.GetConfigOrDie(), mgrOptions)
	if err != nil {
		setupLog.Error(err, "Unable to create manager")
		os.Exit(1)
	}

	// Set up the CertDax API client
	certdaxClient := certdax.NewClient(apiURL, apiKey)

	// Set up the controller
	reconciler := &controller.CertDaxCertificateReconciler{
		Client:      mgr.GetClient(),
		Scheme:      mgr.GetScheme(),
		CertDaxAPI:  certdaxClient,
		DefaultSync: defaultSync,
	}
	if err := reconciler.SetupWithManager(mgr); err != nil {
		setupLog.Error(err, "Unable to create controller")
		os.Exit(1)
	}

	// Health checks
	if err := mgr.AddHealthzCheck("healthz", healthz.Ping); err != nil {
		setupLog.Error(err, "Unable to set up health check")
		os.Exit(1)
	}
	if err := mgr.AddReadyzCheck("readyz", healthz.Ping); err != nil {
		setupLog.Error(err, "Unable to set up readiness check")
		os.Exit(1)
	}

	setupLog.Info("Starting CertDax Kubernetes Operator",
		"apiURL", apiURL,
		"syncInterval", defaultSync.String(),
		"version", version,
	)

	// Start heartbeat goroutine
	operatorToken := os.Getenv("CERTDAX_OPERATOR_TOKEN")
	if operatorToken != "" {
		heartbeatClient := certdax.NewClient(apiURL, operatorToken)
		k8sClient := mgr.GetClient()
		go runHeartbeat(heartbeatClient, k8sClient, namespace, 30*time.Second, logBuf)
		setupLog.Info("Heartbeat reporting enabled")
	} else {
		setupLog.Info("CERTDAX_OPERATOR_TOKEN not set, heartbeat reporting disabled")
	}

	if err := mgr.Start(ctrl.SetupSignalHandler()); err != nil {
		setupLog.Error(err, "Problem running manager")
		os.Exit(1)
	}
}

func runHeartbeat(heartbeatClient *certdax.Client, k8sClient client.Client, watchNamespace string, interval time.Duration, logBuf *logbuffer.RingBuffer) {
	logger := ctrl.Log.WithName("heartbeat")

	// Prime CPU measurement before waiting so first heartbeat already has a delta
	prevCPUTime := getProcessCPUTime()
	prevWall := time.Now()

	// Wait a bit for the cache to sync
	time.Sleep(5 * time.Second)

	// Discover Kubernetes version (once)
	k8sVersion := discoverK8sVersion()

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for ; true; <-ticker.C {
		cpuTime := getProcessCPUTime()
		now := time.Now()

		var cpuPercent string
		wallDelta := now.Sub(prevWall).Seconds()
		if wallDelta > 0 {
			pct := (cpuTime - prevCPUTime) / wallDelta * 100
			cpuPercent = fmt.Sprintf("%.1f%%", pct)
		}
		prevCPUTime = cpuTime
		prevWall = now

		payload := buildHeartbeatPayload(k8sClient, watchNamespace, cpuPercent, logBuf, k8sVersion)
		hbResp, err := heartbeatClient.SendHeartbeat(payload)
		if err != nil {
			logger.Error(err, "Failed to send heartbeat")
			continue
		}

		// Reconcile desired certificates from the dashboard
		if len(hbResp.DesiredCertificates) > 0 || true {
			reconcileDesiredCertificates(k8sClient, watchNamespace, hbResp.DesiredCertificates, logger)
		}
	}
}

const dashboardManagedLabel = "certdax.com/dashboard-managed"

// reconcileDesiredCertificates ensures the cluster matches the desired state from the CertDax dashboard.
// It creates missing CertDaxCertificate CRs and deletes ones removed from the dashboard.
// Only CRs with the "certdax.com/dashboard-managed" label are managed; manually-created CRs are untouched.
func reconcileDesiredCertificates(k8sClient client.Client, watchNamespace string, desired []certdax.DesiredCertificate, logger logr.Logger) {
	ctx := context.Background()

	// Build a set of desired deployment IDs
	desiredByID := make(map[int]certdax.DesiredCertificate, len(desired))
	for _, d := range desired {
		desiredByID[d.ID] = d
	}

	// List all dashboard-managed CertDaxCertificates
	var certList certdaxv1alpha1.CertDaxCertificateList
	listOpts := []client.ListOption{
		client.MatchingLabels{dashboardManagedLabel: "true"},
	}
	if watchNamespace != "" {
		listOpts = append(listOpts, client.InNamespace(watchNamespace))
	}
	if err := k8sClient.List(ctx, &certList, listOpts...); err != nil {
		logger.Error(err, "Failed to list dashboard-managed CertDaxCertificates")
		return
	}

	// Track existing deployment IDs in cluster
	existingIDs := make(map[int]certdaxv1alpha1.CertDaxCertificate)
	for _, cr := range certList.Items {
		if idStr, ok := cr.Labels["certdax.com/deployment-id"]; ok {
			if id, err := strconv.Atoi(idStr); err == nil {
				existingIDs[id] = cr
			}
		}
	}

	// Create missing CRs
	for id, d := range desiredByID {
		if _, exists := existingIDs[id]; exists {
			continue
		}
		ns := d.Namespace
		if ns == "" {
			ns = "default"
		}
		crName := fmt.Sprintf("cdx-deploy-%d", id)

		cr := &certdaxv1alpha1.CertDaxCertificate{
			ObjectMeta: metav1.ObjectMeta{
				Name:      crName,
				Namespace: ns,
				Labels: map[string]string{
					dashboardManagedLabel:     "true",
					"certdax.com/deployment-id": strconv.Itoa(id),
				},
			},
			Spec: certdaxv1alpha1.CertDaxCertificateSpec{
				CertificateID: d.CertificateID,
				Type:          d.Type,
				SecretName:    d.SecretName,
				SyncInterval:  d.SyncInterval,
				IncludeCA:     d.IncludeCA,
			},
		}

		if err := k8sClient.Create(ctx, cr); err != nil {
			if k8serrors.IsAlreadyExists(err) {
				continue
			}
			logger.Error(err, "Failed to create CertDaxCertificate from dashboard", "name", crName, "namespace", ns)
		} else {
			logger.Info("Created CertDaxCertificate from dashboard", "name", crName, "namespace", ns, "certificateId", d.CertificateID)
		}
	}

	// Delete CRs that are no longer desired
	for id, cr := range existingIDs {
		if _, wanted := desiredByID[id]; wanted {
			continue
		}
		crCopy := cr
		if err := k8sClient.Delete(ctx, &crCopy); err != nil {
			if !k8serrors.IsNotFound(err) {
				logger.Error(err, "Failed to delete CertDaxCertificate removed from dashboard", "name", cr.Name, "namespace", cr.Namespace)
			}
		} else {
			logger.Info("Deleted CertDaxCertificate removed from dashboard", "name", cr.Name, "namespace", cr.Namespace)
		}
	}
}

// getProcessCPUTime returns the process CPU time (user + system) in seconds
// using the getrusage syscall, which is always available.
func getProcessCPUTime() float64 {
	var usage syscall.Rusage
	if err := syscall.Getrusage(syscall.RUSAGE_SELF, &usage); err != nil {
		return 0
	}
	userSec := float64(usage.Utime.Sec) + float64(usage.Utime.Usec)/1e6
	sysSec := float64(usage.Stime.Sec) + float64(usage.Stime.Usec)/1e6
	return userSec + sysSec
}

func discoverK8sVersion() string {
	cfg, err := ctrl.GetConfig()
	if err != nil {
		return ""
	}
	dc, err := discovery.NewDiscoveryClientForConfig(cfg)
	if err != nil {
		return ""
	}
	info, err := dc.ServerVersion()
	if err != nil {
		return ""
	}
	return info.GitVersion
}

func buildHeartbeatPayload(k8sClient client.Client, watchNamespace string, cpuPercent string, logBuf *logbuffer.RingBuffer, k8sVersion string) *certdax.HeartbeatPayload {
	ctx := context.Background()

	// Count managed CertDaxCertificates
	var certList certdaxv1alpha1.CertDaxCertificateList
	listOpts := []client.ListOption{}
	if watchNamespace != "" {
		listOpts = append(listOpts, client.InNamespace(watchNamespace))
	}
	// Build a map of secret (ns/name) -> ingress/ingressroute names that reference it
	secretToIngresses := map[string][]string{}

	// Standard Kubernetes Ingresses
	var ingressList networkingv1.IngressList
	if err := k8sClient.List(ctx, &ingressList); err == nil {
		for _, ing := range ingressList.Items {
			for _, tls := range ing.Spec.TLS {
				key := ing.Namespace + "/" + tls.SecretName
				secretToIngresses[key] = append(secretToIngresses[key], ing.Namespace+"/"+ing.Name)
			}
		}
	}

	// Traefik IngressRoutes
	irGVK := schema.GroupVersionKind{Group: "traefik.io", Version: "v1alpha1", Kind: "IngressRoute"}
	irList := &unstructured.UnstructuredList{}
	irList.SetGroupVersionKind(irGVK)
	if err := k8sClient.List(ctx, irList); err == nil {
		for _, ir := range irList.Items {
			tlsObj, found, _ := unstructured.NestedMap(ir.Object, "spec", "tls")
			if !found {
				continue
			}
			if secretName, ok := tlsObj["secretName"].(string); ok && secretName != "" {
				key := ir.GetNamespace() + "/" + secretName
				secretToIngresses[key] = append(secretToIngresses[key], ir.GetNamespace()+"/"+ir.GetName())
			}
		}
	}

	managed, ready, failed := 0, 0, 0
	var certs []certdax.ManagedCert
	if err := k8sClient.List(ctx, &certList, listOpts...); err == nil {
		managed = len(certList.Items)
		for _, c := range certList.Items {
			if c.Status.Ready {
				ready++
			} else {
				failed++
			}
			ns := c.Spec.SecretNamespace
			if ns == "" {
				ns = c.Namespace
			}
			certs = append(certs, certdax.ManagedCert{
				CertificateID: c.Spec.CertificateID,
				Type:          c.Spec.Type,
				SecretName:    c.Spec.SecretName,
				Namespace:     ns,
				CommonName:    c.Status.CommonName,
				Ready:         c.Status.Ready,
				ExpiresAt:     c.Status.ExpiresAt,
				LastSyncedAt:  c.Status.LastSyncedAt,
				Message:       c.Status.Message,
				Ingresses:     secretToIngresses[ns+"/"+c.Spec.SecretName],
			})
		}
	}

	// Collect last error from any failed cert
	var lastError string
	for _, c := range certList.Items {
		if !c.Status.Ready && c.Status.Message != "" {
			lastError = c.Status.Message
			break
		}
	}

	// Get memory stats
	var memStats runtime.MemStats
	runtime.ReadMemStats(&memStats)

	return &certdax.HeartbeatPayload{
		Namespace:           os.Getenv("POD_NAMESPACE"),
		DeploymentName:      os.Getenv("DEPLOYMENT_NAME"),
		ClusterName:         os.Getenv("CLUSTER_NAME"),
		OperatorVersion:     version,
		KubernetesVersion:   k8sVersion,
		PodName:             os.Getenv("POD_NAME"),
		NodeName:            os.Getenv("NODE_NAME"),
		CPUUsage:            cpuPercent,
		MemoryUsage:         fmt.Sprintf("%.1f MiB", float64(memStats.Alloc)/1024/1024),
		ManagedCertificates: managed,
		ReadyCertificates:   ready,
		FailedCertificates:  failed,
		Certificates:        certs,
		LastError:           lastError,
		RecentLogs:          logBuf.Lines(),
	}
}
