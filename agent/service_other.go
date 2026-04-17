//go:build !windows

package main

// isWindowsService always returns false on non-Windows platforms.
func isWindowsService() (bool, error) { return false, nil }

// runAsWindowsService is a no-op on non-Windows platforms.
func runAsWindowsService(_ *Agent) error { return nil }
