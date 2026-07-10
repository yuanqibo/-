#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SDK_DIR="$PROJECT_DIR/vendor/ecp-sdk-java"
VERSION="1.0.3-release"

mvn -q install:install-file \
  -Dfile="$SDK_DIR/spring-cloud-starter-parent-3.4.7.25.pom" \
  -DpomFile="$SDK_DIR/spring-cloud-starter-parent-3.4.7.25.pom" \
  -Dpackaging=pom

mvn -q install:install-file \
  -Dfile="$SDK_DIR/ecp-sdk-java-parent-$VERSION.pom" \
  -DpomFile="$SDK_DIR/ecp-sdk-java-parent-$VERSION.pom" \
  -Dpackaging=pom

mvn -q install:install-file \
  -Dfile="$SDK_DIR/ecp-api-common-1.0.1-release.jar" \
  -DpomFile="$SDK_DIR/ecp-api-common-1.0.1-release.pom"

for artifact in ecp-sdk-common ecp-client-sdk ecp-sdk-spring-boot-starter; do
  mvn -q install:install-file \
    -Dfile="$SDK_DIR/$artifact-$VERSION.jar" \
    -DpomFile="$SDK_DIR/$artifact-$VERSION.pom"
done
