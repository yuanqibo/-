#!/usr/bin/env bash
set -euo pipefail

SERVER="${1:-${DEPLOY_SERVER:-}}"
REMOTE_DIR="${REMOTE_DIR:-/opt/asset-portal}"
REMOTE_USER="${REMOTE_USER:-access}"

if [[ -z "$SERVER" ]]; then
  echo "Usage: scripts/deploy.sh <server-ip-or-host>"
  echo "Example: scripts/deploy.sh 192.168.1.20"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

rsync -az --delete \
  --exclude '.DS_Store' \
  --exclude '.git/' \
  --exclude 'data/' \
  --exclude 'node_modules/' \
  --exclude 'backend/target/' \
  --exclude '*.log' \
  --exclude '*.pid' \
  --exclude '.env' \
  "$PROJECT_DIR/" "$REMOTE_USER@$SERVER:$REMOTE_DIR/"

ssh "$REMOTE_USER@$SERVER" "cd '$REMOTE_DIR' && npm ci && VITE_ECP_AUTH_CONFIG_SOURCE_MODE=local npm run build && npm run install:ecp-java-sdk && mvn -f backend/pom.xml clean package && sudo systemctl restart asset-portal && sudo systemctl --no-pager --full status asset-portal"

echo "Deployed to http://$SERVER:5387/"
