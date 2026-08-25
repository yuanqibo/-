FROM eclipse-temurin:17-jre-jammy

WORKDIR /opt/asset-portal
ENV HOST=0.0.0.0 PORT=5387 ECP_SDK_ENABLED=true

COPY dist ./app.jar

USER 10001:10001
EXPOSE 5387
ENTRYPOINT ["java", "-jar", "app.jar"]
