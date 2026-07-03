#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/asset-portal}"

cd "$APP_DIR"
git pull --ff-only
npm install --omit=dev
sudo systemctl restart asset-portal
sudo systemctl --no-pager --full status asset-portal

echo "Updated from Git and restarted asset-portal."
