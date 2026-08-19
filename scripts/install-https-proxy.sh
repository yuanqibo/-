#!/usr/bin/env bash
set -euo pipefail

CERT_SOURCE="${1:?Usage: scripts/install-https-proxy.sh <fullchain.pem> <privkey.pem> [nginx-config]}"
KEY_SOURCE="${2:?Usage: scripts/install-https-proxy.sh <fullchain.pem> <privkey.pem> [nginx-config]}"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_SOURCE="${3:-$PROJECT_DIR/ops/nginx/asset-portal.conf}"
CERT_DIR="/etc/nginx/ssl/asset.acg.team"

if [[ "$(id -u)" -ne 0 ]]; then
  exec sudo "$0" "$CERT_SOURCE" "$KEY_SOURCE"
fi

test -f "$CERT_SOURCE"
test -f "$KEY_SOURCE"
test -f "$CONFIG_SOURCE"

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y nginx
install -d -m 700 "$CERT_DIR"
install -m 644 "$CERT_SOURCE" "$CERT_DIR/fullchain.pem"
install -m 600 "$KEY_SOURCE" "$CERT_DIR/privkey.pem"
install -m 644 "$CONFIG_SOURCE" /etc/nginx/conf.d/asset-portal.conf

nginx -t
systemctl enable --now nginx
systemctl reload nginx

echo 'HTTPS proxy enabled at https://asset.acg.team/'
