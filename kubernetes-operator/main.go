package main

import (
	"context"
	"fmt"
	"os"
	"runtime"
	"time"

	k8sruntime "k8s.io/apimachinery/pkg/runtime"
	utilruntime "k8s.io/apimachinery/pkg/util/runtime"
	clientgoscheme "k8s.io/client-go/kubernetes/scheme"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/cache"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/healthz"
	"sigs.k8s.io/controller-runtime/pkg/log/zap"

	certdaxv1alpha1 "github.com/certdax/kubernetes-operator/api/v1alpha1"
	"github.com/certdax/kubernetes-operator/internal/certdax"
	"github.com/certdax/kubernetes-operator/internal/controller"
)

const version = "1.0.0"

var scheme = k8sruntime.NewScheme()

func init() {
	utilruntime.Must(clientgoscheme.AddToScheme(scheme))
	utilruntime.Must(certdaxv1alpha1.AddToScheme(scheme))
}

func main() {
	opts := zap.Options{Development: false}
	ctrl.SetLogger(zap.New(zap.UseFlagOptions(&opts)))

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
		go runHeartbeat(heartbeatClient, k8sClient, namespace, 30*time.Second)
		setupLog.Info("Heartbeat reporting enabled")
	} else {
		setupLog.Info("CERTDAX_OPERATOR_TOKEN not set, heartbeat reporting disabled")
	}

	if err := mgr.Start(ctrl.SetupSignalHandler()); err != nil {
		setupLog.Error(err, "Problem running manager")
		os.Exit(1)
	}
}

func runHeartbeat(heartbeatClient *certdax.Client, k8sClient client.Client, watchNamespace string, interval time.Duration) {
	logger := ctrl.Log.WithName("heartbeat")

	// Wait a bit for the cache to sync
	time.Sleep(5 * time.Second)

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for ; true; <-ticker.C {
		payload := buildHeartbeatPayload(k8sClient, watchNamespace)
		if err := heartbeatClient.SendHeartbeat(payload); err != nil {
			logger.Error(err, "Failed to send heartbeat")
		}
	}
}

func buildHeartbeatPayload(k8sClient client.Client, watchNamespace string) *certdax.HeartbeatPayload {
	ctx := context.Background()

	// Count managed CertDaxCertificates
	var certList certdaxv1alpha1.CertDaxCertificateList
	listOpts := []client.ListOption{}
	if watchNamespace != "" {
		listOpts = append(listOpts, client.InNamespace(watchNamespace))
	}
	managed, ready, failed := 0, 0, 0
	if err := k8sClient.List(ctx, &certList, listOpts...); err == nil {
		managed = len(certList.Items)
		for _, c := range certList.Items {
			if c.Status.Ready {
				ready++
			} else {
				failed++
			}
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
		PodName:             os.Getenv("POD_NAME"),
		NodeName:            os.Getenv("NODE_NAME"),
		MemoryUsage:         fmt.Sprintf("%.1f MiB", float64(memStats.Alloc)/1024/1024),
		ManagedCertificates: managed,
		ReadyCertificates:   ready,
		FailedCertificates:  failed,
		LastError:           lastError,
	}
}
