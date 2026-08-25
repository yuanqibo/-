#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/asset-portal}"
APP_USER="${APP_USER:-$USER}"
PORT="${PORT:-5387}"
DATABASE_URL="${DATABASE_URL:-jdbc:mysql://127.0.0.1:3306/asset_portal?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai}"
DATABASE_USER="${DATABASE_USER:-asset_portal}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-http://localhost:$PORT}"

if [[ -z "${DATABASE_PASSWORD:-}" ]]; then
  echo "DATABASE_PASSWORD is required."
  echo "Example: DATABASE_PASSWORD='your-password' bash scripts/setup-server.sh"
  exit 1
fi

if [[ -z "${ECP_APP_SECRET:-}" ]]; then
  echo "ECP_APP_SECRET is required."
  exit 1
fi

if [[ "${APPROVAL_INTEGRATION_ENABLED:-false}" == "true" && -z "${APPROVAL_TEMPLATE_CODE:-}" ]]; then
  echo "APPROVAL_TEMPLATE_CODE is required when APPROVAL_INTEGRATION_ENABLED=true."
  exit 1
fi

if [[ "${ECP_SDK_PERMISSION_ENABLED:-false}" == "true" && -z "${ECP_SDK_PERMISSION_SNAPSHOT_SIGNING_SECRET:-}" ]]; then
  echo "ECP_SDK_PERMISSION_SNAPSHOT_SIGNING_SECRET is required when ECP_SDK_PERMISSION_ENABLED=true."
  exit 1
fi

if [[ "${LEGACY_ASSET_SYNC_ENABLED:-false}" == "true" ]]; then
  if [[ -z "${LEGACY_ASSET_SYNC_APP_ID:-}" || -z "${LEGACY_ASSET_SYNC_APP_SECRET:-}" ]]; then
    echo "LEGACY_ASSET_SYNC_APP_ID and LEGACY_ASSET_SYNC_APP_SECRET are required when legacy asset sync is enabled."
    exit 1
  fi
fi

if [[ -z "${ASSET_PORTAL_SYSTEM_CONFIG_ENCRYPTION_KEY:-}" ]]; then
  echo "ASSET_PORTAL_SYSTEM_CONFIG_ENCRYPTION_KEY is required. Generate one with: openssl rand -base64 32"
  exit 1
fi

sudo mkdir -p "$APP_DIR"
sudo chown -R "$APP_USER:$APP_USER" "$APP_DIR"

cat > "$APP_DIR/.env" <<EOF
HOST=0.0.0.0
PORT=$PORT
VITE_ECP_APP_CODE=WLY5YG
VITE_ECP_API_BASE_URL=/api/v1
VITE_ECP_AUTH_CONFIG_SOURCE_MODE=local
DATABASE_URL=$DATABASE_URL
DATABASE_USER=$DATABASE_USER
DATABASE_PASSWORD=$DATABASE_PASSWORD
PUBLIC_BASE_URL=$PUBLIC_BASE_URL
ECP_SDK_ENABLED=true
ECP_APP_SECRET=$ECP_APP_SECRET
APPROVAL_INTEGRATION_ENABLED=${APPROVAL_INTEGRATION_ENABLED:-false}
APPROVAL_TEMPLATE_CODE=${APPROVAL_TEMPLATE_CODE:-}
APPROVAL_MAIN_TABLE_CODE=${APPROVAL_MAIN_TABLE_CODE:-MAIN}
APPROVAL_CALLBACK_URL=${APPROVAL_CALLBACK_URL:-}
ECP_SDK_PERMISSION_ENABLED=${ECP_SDK_PERMISSION_ENABLED:-false}
ECP_SDK_PERMISSION_SNAPSHOT_SIGNING_SECRET=${ECP_SDK_PERMISSION_SNAPSHOT_SIGNING_SECRET:-}
ECP_TENANT_ID=${ECP_TENANT_ID:-}
ASSET_PORTAL_SYSTEM_CONFIG_ENCRYPTION_KEY=$ASSET_PORTAL_SYSTEM_CONFIG_ENCRYPTION_KEY
LEGACY_ASSET_SYNC_ENABLED=${LEGACY_ASSET_SYNC_ENABLED:-false}
LEGACY_ASSET_SYNC_READ_ONLY=${LEGACY_ASSET_SYNC_READ_ONLY:-true}
LEGACY_ASSET_SYNC_BASE_URL=${LEGACY_ASSET_SYNC_BASE_URL:-https://ams.bearrental.com}
LEGACY_ASSET_SYNC_APP_ID=${LEGACY_ASSET_SYNC_APP_ID:-}
LEGACY_ASSET_SYNC_APP_SECRET=${LEGACY_ASSET_SYNC_APP_SECRET:-}
LEGACY_ASSET_SYNC_USERNAME=${LEGACY_ASSET_SYNC_USERNAME:-}
LEGACY_ASSET_SYNC_REQUEST_INTERVAL=${LEGACY_ASSET_SYNC_REQUEST_INTERVAL:-250ms}
LEGACY_ASSET_SYNC_CRON=${LEGACY_ASSET_SYNC_CRON:-0 0/30 * * * *}
LEGACY_ASSET_SYNC_ZONE=${LEGACY_ASSET_SYNC_ZONE:-Asia/Shanghai}
LEGACY_ASSET_SYNC_BOOTSTRAP_ENABLED=${LEGACY_ASSET_SYNC_BOOTSTRAP_ENABLED:-false}
LEGACY_ASSET_SYNC_PAGE_SIZE=${LEGACY_ASSET_SYNC_PAGE_SIZE:-100}
EOF
sudo chown "$APP_USER:$APP_USER" "$APP_DIR/.env"
sudo chmod 600 "$APP_DIR/.env"

sudo tee /etc/systemd/system/asset-portal.service >/dev/null <<EOF
[Unit]
Description=Asset Portal
After=network.target mysql.service

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env
ExecStart=/usr/bin/java -jar $APP_DIR/backend/target/access-assets-server-1.0.0.jar
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable asset-portal

echo "Server service installed."
echo "After uploading app files, run: sudo systemctl restart asset-portal"
