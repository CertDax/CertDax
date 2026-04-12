#!/bin/sh
# CertDax Agent installer
# Usage: curl -sSL https://your-server/install.sh | sh
# Or: ./install.sh [--path /custom/path]

set -e

INSTALL_DIR="/usr/local/bin"
BINARY_NAME="certdax-agent"
CONFIG_DIR="/etc/certdax"

# Parse args
while [ "$#" -gt 0 ]; do
  case "$1" in
    --path) INSTALL_DIR="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# Detect architecture
ARCH=$(uname -m)
case "$ARCH" in
  x86_64)  GOARCH="amd64" ;;
  aarch64) GOARCH="arm64" ;;
  armv7l|armv6l) GOARCH="arm" ;;
  i686|i386) GOARCH="386" ;;
  *) echo "Unsupported architecture: $ARCH"; exit 1 ;;
esac

OS=$(uname -s | tr '[:upper:]' '[:lower:]')
if [ "$OS" != "linux" ]; then
  echo "Unsupported OS: $OS (only linux is supported)"
  exit 1
fi

BINARY="${BINARY_NAME}-${OS}-${GOARCH}"

echo "CertDax Agent Installer"
echo "==========================="
echo "Architecture: ${ARCH} (${GOARCH})"
echo "Install dir:  ${INSTALL_DIR}"
echo ""

# Check if binary exists in current directory (local install)
if [ -f "dist/${BINARY}" ]; then
  SRC="dist/${BINARY}"
elif [ -f "${BINARY}" ]; then
  SRC="${BINARY}"
else
  echo "Error: Binary '${BINARY}' not found."
  echo "Build with: make all"
  exit 1
fi

# Install binary
install -d "$INSTALL_DIR"
install -m 755 "$SRC" "${INSTALL_DIR}/${BINARY_NAME}"

echo "Installed ${BINARY_NAME} to ${INSTALL_DIR}/${BINARY_NAME}"

# Create config directory
if [ ! -d "$CONFIG_DIR" ]; then
  mkdir -p "$CONFIG_DIR"
  echo "Created config directory: ${CONFIG_DIR}"
fi

# Copy example config if no config exists
if [ ! -f "${CONFIG_DIR}/config.yaml" ] && [ -f "config.example.yaml" ]; then
  cp config.example.yaml "${CONFIG_DIR}/config.yaml"
  chmod 600 "${CONFIG_DIR}/config.yaml"
  echo "Copied example config to ${CONFIG_DIR}/config.yaml"
  echo "  -> Edit this file with your API URL and agent token"
fi

# Install systemd service if available
if [ -d "/etc/systemd/system" ] && [ -f "certdax-agent.service" ]; then
  cp certdax-agent.service /etc/systemd/system/
  systemctl daemon-reload
  echo ""
  echo "Systemd service installed. Enable with:"
  echo "  systemctl enable --now certdax-agent"
fi

echo ""
echo "Done! Verify with: ${BINARY_NAME} --version"
