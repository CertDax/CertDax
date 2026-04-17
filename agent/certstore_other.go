//go:build !windows

package main

// deployToWindowsStore is a no-op on non-Windows platforms.
func deployToWindowsStore(certPEM string, isCA bool) error {
	return nil
}

// removeFromWindowsStore is a no-op on non-Windows platforms.
func removeFromWindowsStore(thumbprint string, isCA bool) error {
	return nil
}
