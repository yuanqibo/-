FROM node:22-alpine AS frontend-build
WORKDIR /build
COPY package.json package-lock.json ./
COPY vendor ./vendor
RUN npm ci
COPY index.html tsconfig.json vite.config.ts ./
COPY authz ./authz
COPY public ./public
COPY src ./src
RUN npm run validate:authz && npm run build

FROM maven:3.9.11-eclipse-temurin-21 AS backend-build
WORKDIR /build
COPY vendor/ecp-sdk-java ./vendor/ecp-sdk-java
COPY scripts/install-ecp-java-sdk.sh ./scripts/install-ecp-java-sdk.sh
RUN bash scripts/install-ecp-java-sdk.sh
COPY backend/pom.xml ./pom.xml
RUN mvn -B dependency:go-offline
COPY backend/src ./src
RUN mvn -B package -DskipTests

FROM eclipse-temurin:21-jre-alpine
WORKDIR /opt/asset-portal
ENV NODE_ENV=production HOST=0.0.0.0 PORT=5387 ECP_SDK_ENABLED=true
COPY --from=frontend-build /build/dist ./dist
COPY --from=backend-build /build/target/access-assets-server-1.0.0.jar ./app.jar
RUN mkdir -p data && addgroup -S asset && adduser -S asset -G asset && chown -R asset:asset /opt/asset-portal
USER asset
EXPOSE 5387
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:5387/actuator/health >/dev/null || exit 1
CMD ["java", "-jar", "app.jar"]
