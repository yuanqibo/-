#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/asset-portal}"
APP_USER="${APP_USER:-$USER}"
PORT="${PORT:-5387}"
MYSQL_HOST="${MYSQL_HOST:-127.0.0.1}"
MYSQL_PORT="${MYSQL_PORT:-3306}"
MYSQL_DATABASE="${MYSQL_DATABASE:-asset_portal}"
MYSQL_USER="${MYSQL_USER:-asset_portal}"

if [[ -z "${MYSQL_PASSWORD:-}" ]]; then
  echo "MYSQL_PASSWORD is required."
  echo "Example: MYSQL_PASSWORD='your-password' bash scripts/setup-server.sh"
  exit 1
fi

sudo mkdir -p "$APP_DIR"
sudo chown -R "$APP_USER:$APP_USER" "$APP_DIR"

cat > "$APP_DIR/.env" <<EOF
HOST=0.0.0.0
PORT=$PORT
DB_DRIVER=mysql
MYSQL_HOST=$MYSQL_HOST
MYSQL_PORT=$MYSQL_PORT
MYSQL_USER=$MYSQL_USER
MYSQL_PASSWORD=$MYSQL_PASSWORD
MYSQL_DATABASE=$MYSQL_DATABASE
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
ExecStart=/usr/bin/node $APP_DIR/server.mjs
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable asset-portal

echo "Server service installed."
echo "After uploading app files, run: sudo systemctl restart asset-portal"

