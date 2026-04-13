package main

import (
	"fmt"
	"os"
	"time"

	"k8s.io/apimachinery/pkg/runtime"
	utilruntime "k8s.io/apimachinery/pkg/util/runtime"
	clientgoscheme "k8s.io/client-go/kubernetes/scheme"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/cache"
	"sigs.k8s.io/controller-runtime/pkg/healthz"
	"sigs.k8s.io/controller-runtime/pkg/log/zap"

	certdaxv1alpha1 "github.com/certdax/kubernetes-operator/api/v1alpha1"
	"github.com/certdax/kubernetes-operator/internal/certdax"
	"github.com/certdax/kubernetes-operator/internal/controller"
)

var scheme = runtime.NewScheme()

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
	)

	if err := mgr.Start(ctrl.SetupSignalHandler()); err != nil {
		setupLog.Error(err, "Problem running manager")
		os.Exit(1)
	}
}
