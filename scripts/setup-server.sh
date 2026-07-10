#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/asset-portal}"
APP_USER="${APP_USER:-$USER}"
PORT="${PORT:-5387}"
DATABASE_URL="${DATABASE_URL:-jdbc:mysql://127.0.0.1:3306/asset_portal?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai}"
DATABASE_USER="${DATABASE_USER:-asset_portal}"

if [[ -z "${DATABASE_PASSWORD:-}" ]]; then
  echo "DATABASE_PASSWORD is required."
  echo "Example: DATABASE_PASSWORD='your-password' bash scripts/setup-server.sh"
  exit 1
fi

if [[ -z "${ECP_APP_SECRET:-}" || -z "${ECP_SDK_PERMISSION_SNAPSHOT_SIGNING_SECRET:-}" ]]; then
  echo "ECP_APP_SECRET and ECP_SDK_PERMISSION_SNAPSHOT_SIGNING_SECRET are required."
  exit 1
fi

sudo mkdir -p "$APP_DIR"
sudo chown -R "$APP_USER:$APP_USER" "$APP_DIR"

cat > "$APP_DIR/.env" <<EOF
HOST=0.0.0.0
PORT=$PORT
DATABASE_URL=$DATABASE_URL
DATABASE_USER=$DATABASE_USER
DATABASE_PASSWORD=$DATABASE_PASSWORD
ECP_SDK_ENABLED=true
ECP_APP_SECRET=$ECP_APP_SECRET
ECP_SDK_PERMISSION_SNAPSHOT_SIGNING_SECRET=$ECP_SDK_PERMISSION_SNAPSHOT_SIGNING_SECRET
EOF

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
