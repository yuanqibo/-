#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/asset-portal}"

cd "$APP_DIR"
git pull --ff-only
npm ci
npm run build
npm run install:ecp-java-sdk
mvn -f backend/pom.xml clean package -DskipTests
sudo systemctl restart asset-portal
sudo systemctl --no-pager --full status asset-portal

echo "Updated from Git and restarted asset-portal."
