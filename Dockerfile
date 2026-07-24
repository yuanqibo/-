FROM swr.cn-east-3.myhuaweicloud.com/access/maven:3.9.6-17.0.10

WORKDIR /opt/asset-portal
ENV HOST=0.0.0.0 PORT=5387 ECP_SDK_ENABLED=true

COPY dist ./app.jar

USER 10001:10001
EXPOSE 5387
ENTRYPOINT ["java", "-jar", "app.jar"]
