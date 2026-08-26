package team.acg.access.assets.sync;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.LinkedHashMap;
import java.util.Map;

@Component
public class LegacyAmsClient {
    private static final String SUCCESS_CODE = "J00000";
    private static final ZoneId API_ZONE = ZoneId.of("Asia/Shanghai");
    private static final DateTimeFormatter API_TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")
        .withZone(API_ZONE);

    private final ObjectMapper mapper;
    private final LegacyAssetSyncProperties properties;
    private final HttpClient http;
    private final Object requestIntervalLock = new Object();
    private volatile Token token;
    private Instant nextBusinessRequestAt = Instant.EPOCH;

    LegacyAmsClient(ObjectMapper mapper, LegacyAssetSyncProperties properties) {
        this.mapper = mapper;
        this.properties = properties;
        this.http = HttpClient.newBuilder()
            .connectTimeout(properties.getRequestTimeout())
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();
    }

    JsonNode queryAssetChanges(Instant start, Instant end) {
        ObjectNode param = mapper.createObjectNode()
            .put("startTime", API_TIME.format(start))
            .put("endTime", API_TIME.format(end));
        return post("/openApi/asset/queryAssetChange", param).path("assetChangeApiDataList");
    }

    JsonNode queryAssetDetail(long assetId) {
        return post("/openApi/asset/queryAssetDetail", mapper.createObjectNode().put("assetId", assetId));
    }

    /**
     * pageAsset is the documented source for quoteStatus, unlike queryAssetDetail.
     * Use it for changed rows as well as full snapshots so workflow markers do not disappear.
     */
    JsonNode queryAssetSnapshot(long assetId) {
        ObjectNode param = mapper.createObjectNode()
            .put("pageNum", 1)
            .put("pageSize", 1)
            .put("isDispose", 1);
        param.putArray("assetIdList").add(assetId);
        JsonNode items = post("/openApi/asset/pageAsset", param).path("list");
        if (!items.isArray()) throw new LegacyAmsException("Legacy AMS pageAsset response has no list");
        for (JsonNode item : items) {
            if (item.path("assetId").asLong(0) == assetId) return item;
        }
        throw new LegacyAmsException("Legacy AMS pageAsset response has no requested asset: " + assetId);
    }

    JsonNode pageAssets(int page, int size, boolean includeDisposed) {
        ObjectNode param = mapper.createObjectNode()
            .put("pageNum", page)
            .put("pageSize", size)
            .put("isDispose", includeDisposed ? 1 : 0);
        return post("/openApi/asset/pageAsset", param);
    }

    private JsonNode post(String path, ObjectNode param) {
        String accessToken = accessToken();
        try {
            return postWithToken(path, param, accessToken);
        } catch (LegacyAmsException error) {
            if (!"J30002".equals(error.code())) throw error;
            invalidateToken(accessToken);
            return postWithToken(path, param, accessToken());
        }
    }

    private JsonNode postWithToken(String path, ObjectNode param, String accessToken) {
        final String paramText;
        try {
            paramText = mapper.writeValueAsString(param);
        } catch (IOException error) {
            throw new LegacyAmsException("Unable to serialize legacy API parameters", error);
        }
        long timestamp = System.currentTimeMillis();
        ObjectNode requestBody = mapper.createObjectNode()
            .put("param", paramText)
            .put("timestamp", Long.toString(timestamp))
            .put("token", accessToken);
        requestBody.put("sign", LegacyAmsSigner.sign(accessToken, timestamp, paramText));
        return send(path, requestBody);
    }

    private void invalidateToken(String failedToken) {
        synchronized (this) {
            if (token != null && token.value().equals(failedToken)) token = null;
        }
    }

    private String accessToken() {
        Token current = token;
        if (current != null && current.expiresAt().isAfter(Instant.now().plusSeconds(30))) return current.value();
        synchronized (this) {
            current = token;
            if (current != null && current.expiresAt().isAfter(Instant.now().plusSeconds(30))) return current.value();
            String appId = text(properties.getAppId());
            String appSecret = text(properties.getAppSecret());
            if (appId.isEmpty() || appSecret.isEmpty()) throw new LegacyAmsException("Legacy AMS appId/appSecret is not configured");
            String username = text(properties.getUsername());
            ObjectNode body = mapper.createObjectNode().put("appId", appId).put("appSecret", appSecret);
            String tokenPath = "/openApi/getOpenToken";
            if (!username.isEmpty()) {
                tokenPath = "/openApi/getAuthOpenToken";
                body.put("userName", username);
            }
            JsonNode response = send(tokenPath, body);
            String value = response.asText("").trim();
            if (value.isEmpty()) throw new LegacyAmsException("Legacy AMS returned an empty token");
            token = new Token(value, Instant.now().plus(Duration.ofHours(11)));
            return value;
        }
    }

    private JsonNode send(String path, ObjectNode body) {
        for (int attempt = 0; ; attempt++) {
            try {
                waitForBusinessRequestSlot(path);
                HttpRequest request = HttpRequest.newBuilder(URI.create(baseUrl() + path))
                    .timeout(properties.getRequestTimeout())
                    .header("Content-Type", "application/json;charset=UTF-8")
                    .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body), java.nio.charset.StandardCharsets.UTF_8))
                    .build();
                HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString(java.nio.charset.StandardCharsets.UTF_8));
                if (response.statusCode() < 200 || response.statusCode() >= 300) {
                    // SafeLine 468 is a frequency protection page, not a transient API response.
                    // Retrying it immediately extends the vendor's cooldown window.
                    if (response.statusCode() == 468) {
                        throw new LegacyAmsException("Legacy AMS SafeLine blocked this run for request frequency; wait for the next scheduled run");
                    }
                    if (isRetryableStatus(response.statusCode()) && attempt < 4) {
                        pauseBeforeRetry(attempt);
                        continue;
                    }
                    throw new LegacyAmsException("Legacy AMS HTTP status " + response.statusCode());
                }
                JsonNode envelope = mapper.readTree(response.body());
                String code = envelope.path("code").asText("UNKNOWN");
                if (!envelope.path("success").asBoolean(false) || !SUCCESS_CODE.equals(code)) {
                    throw new LegacyAmsException("Legacy AMS error " + code + ": "
                        + envelope.path("message").asText(""), code);
                }
                JsonNode data = envelope.get("data");
                if (data == null || data.isNull()) return mapper.nullNode();
                if (data.isTextual() && data.asText().trim().startsWith("{")) return mapper.readTree(data.asText());
                return data;
            } catch (IOException error) {
                throw new LegacyAmsException("Legacy AMS response could not be read", error);
            } catch (InterruptedException error) {
                Thread.currentThread().interrupt();
                throw new LegacyAmsException("Legacy AMS request was interrupted", error);
            }
        }
    }

    private void waitForBusinessRequestSlot(String path) throws InterruptedException {
        if (!path.startsWith("/openApi/asset/")) return;
        synchronized (requestIntervalLock) {
            Instant now = Instant.now();
            if (nextBusinessRequestAt.isAfter(now)) {
                Thread.sleep(Duration.between(now, nextBusinessRequestAt).toMillis());
            }
            nextBusinessRequestAt = Instant.now().plus(properties.getRequestInterval());
        }
    }

    private boolean isRetryableStatus(int status) { return status == 429 || status >= 500; }

    private void pauseBeforeRetry(int attempt) throws InterruptedException {
        Thread.sleep(Duration.ofMillis(500L << attempt).toMillis());
    }

    private String baseUrl() {
        String value = text(properties.getBaseUrl());
        if (value.isEmpty()) throw new LegacyAmsException("Legacy AMS base URL is not configured");
        return value.replaceAll("/$", "");
    }

    private static String text(String value) { return value == null ? "" : value.trim(); }

    private record Token(String value, Instant expiresAt) {}

    static final class LegacyAmsException extends RuntimeException {
        private final String code;

        LegacyAmsException(String message) { this(message, null, null); }
        LegacyAmsException(String message, Throwable cause) { this(message, null, cause); }
        LegacyAmsException(String message, String code) { this(message, code, null); }
        private LegacyAmsException(String message, String code, Throwable cause) {
            super(message, cause);
            this.code = code;
        }
        String code() { return code; }
    }
}
