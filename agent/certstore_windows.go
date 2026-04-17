//go:build windows

package main

import (
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// deployToWindowsStore installs a PEM certificate into the appropriate Windows
// certificate store using certutil:
//   - Root CA (isCA=true)  → LocalMachine\Root   (Trusted Root Certification Authorities)
//   - Other cert (isCA=false) → LocalMachine\My  (Personal)
func deployToWindowsStore(certPEM string, isCA bool) error {
	storeName := "My"
	if isCA {
		storeName = "Root"
	}

	// Write cert to a temp file
	tmpFile, err := os.CreateTemp("", "certdax-*.crt")
	if err != nil {
		return fmt.Errorf("create temp file: %w", err)
	}
	defer os.Remove(tmpFile.Name())

	if _, err := tmpFile.WriteString(certPEM); err != nil {
		tmpFile.Close()
		return fmt.Errorf("write temp file: %w", err)
	}
	tmpFile.Close()

	// certutil -addstore <storeName> <certFile>
	cmd := exec.Command("certutil", "-addstore", storeName, tmpFile.Name())
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("certutil -addstore %s failed: %v — %s", storeName, err, strings.TrimSpace(string(out)))
	}

	log.Printf("[INFO] certutil: installed certificate into LocalMachine\\%s", storeName)
	return nil
}

// removeFromWindowsStore removes a certificate (identified by thumbprint) from
// the appropriate Windows store.
func removeFromWindowsStore(thumbprint string, isCA bool) error {
	storeName := "My"
	if isCA {
		storeName = "Root"
	}

	cmd := exec.Command("certutil", "-delstore", storeName, thumbprint)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("certutil -delstore %s %s failed: %v — %s", storeName, thumbprint, err, strings.TrimSpace(string(out)))
	}

	log.Printf("[INFO] certutil: removed certificate %s from LocalMachine\\%s", thumbprint, storeName)
	return nil
}

// defaultConfigPath returns the Windows default config path.
func defaultConfigPath() string {
	programData := os.Getenv("ProgramData")
	if programData == "" {
		programData = `C:\ProgramData`
	}
	return filepath.Join(programData, "CertDax", "config.yaml")
}
