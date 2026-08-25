package team.acg.access.assets.sync;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class LegacyAmsClientHttpTest {
    private final ObjectMapper mapper = new ObjectMapper();
    private final AtomicInteger tokenRequests = new AtomicInteger();
    private final AtomicInteger authTokenRequests = new AtomicInteger();
    private final AtomicInteger changeRequests = new AtomicInteger();
    private final AtomicInteger detailRequests = new AtomicInteger();
    private final AtomicInteger pageRequests = new AtomicInteger();
    private HttpServer server;
    private LegacyAssetSyncProperties properties;
    private LegacyAmsClient client;
    private volatile boolean expireFirstChange;

    @BeforeEach
    void startServer() throws IOException {
        server = HttpServer.create(new InetSocketAddress("localhost", 0), 0);
        server.createContext("/openApi/getOpenToken", exchange -> respond(exchange,
            envelope(mapper.valueToTree("token-" + tokenRequests.incrementAndGet()))));
        server.createContext("/openApi/getAuthOpenToken", exchange -> respond(exchange,
            envelope(mapper.valueToTree("auth-token-" + authTokenRequests.incrementAndGet()))));
        server.createContext("/openApi/asset/queryAssetChange", exchange -> {
            JsonNode body = readBody(exchange);
            if (changeRequests.incrementAndGet() == 1 && expireFirstChange) {
                respond(exchange, error("J30002", "token expired"));
                return;
            }
            ObjectNode data = mapper.createObjectNode();
            data.putArray("assetChangeApiDataList").addObject()
                .put("assetId", "7").put("assetCode", "PC-007").put("changeType", 1);
            lastChangeBody = body;
            respond(exchange, envelope(data));
        });
        server.createContext("/openApi/asset/queryAssetDetail", exchange -> {
            detailRequests.incrementAndGet();
            ObjectNode data = mapper.createObjectNode().put("assetId", 7).put("assetCode", "PC-007");
            respond(exchange, envelope(data));
        });
        server.createContext("/openApi/asset/pageAsset", exchange -> {
            if (pageRequests.incrementAndGet() == 1) {
                respond(exchange, 468, "rate limited");
                return;
            }
            ObjectNode data = mapper.createObjectNode().put("hasNextPage", false);
            data.putArray("list").addObject().put("assetId", 7);
            respond(exchange, envelope(data));
        });
        server.start();
        properties = new LegacyAssetSyncProperties();
        properties.setBaseUrl("http://localhost:" + server.getAddress().getPort());
        properties.setAppId("app-id");
        properties.setAppSecret("app-secret");
        properties.setRequestTimeout(Duration.ofSeconds(3));
        properties.setRequestInterval(Duration.ZERO);
        client = new LegacyAmsClient(mapper, properties);
        lastChangeBody = null;
        expireFirstChange = false;
    }

    private JsonNode lastChangeBody;

    @AfterEach
    void stopServer() {
        if (server != null) server.stop(0);
    }

    @Test
    void cachesTokenAndSignsJsonParamUsingShanghaiApiTime() throws Exception {
        Instant start = Instant.parse("2026-08-24T00:00:00Z");
        Instant end = Instant.parse("2026-08-24T01:00:00Z");

        assertThat(client.queryAssetChanges(start, end)).hasSize(1);
        assertThat(client.queryAssetDetail(7).path("assetId").asInt()).isEqualTo(7);
        assertThat(client.queryAssetChanges(start, end)).hasSize(1);
        assertThat(tokenRequests).hasValue(1);
        assertThat(detailRequests).hasValue(1);

        String param = lastChangeBody.path("param").asText();
        assertThat(mapper.readTree(param).path("startTime").asText()).isEqualTo("2026-08-24 08:00:00");
        assertThat(mapper.readTree(param).path("endTime").asText()).isEqualTo("2026-08-24 09:00:00");
        long timestamp = lastChangeBody.path("timestamp").asLong();
        assertThat(lastChangeBody.path("sign").asText())
            .isEqualTo(LegacyAmsSigner.sign("token-1", timestamp, param));
    }

    @Test
    void refreshesTokenOnceWhenLegacyApiReturnsTokenExpired() {
        expireFirstChange = true;

        assertThat(client.queryAssetChanges(Instant.now().minusSeconds(60), Instant.now())).hasSize(1);
        assertThat(tokenRequests).hasValue(2);
        assertThat(changeRequests).hasValue(2);
    }

    @Test
    void usesAccountScopedTokenWhenUsernameIsConfigured() {
        properties.setUsername("legacy-user");
        client = new LegacyAmsClient(mapper, properties);

        assertThat(client.queryAssetChanges(Instant.now().minusSeconds(60), Instant.now())).hasSize(1);
        assertThat(authTokenRequests).hasValue(1);
        assertThat(tokenRequests).hasValue(0);
    }

    @Test
    void stopsImmediatelyWhenVendorSafeLineReturns468() {
        assertThatThrownBy(() -> client.pageAssets(1, 1, true))
            .hasMessageContaining("SafeLine blocked this run");
        assertThat(pageRequests).hasValue(1);
    }

    private JsonNode readBody(HttpExchange exchange) throws IOException {
        return mapper.readTree(exchange.getRequestBody().readAllBytes());
    }

    private String envelope(JsonNode data) {
        ObjectNode body = mapper.createObjectNode().put("success", true).put("code", "J00000");
        body.set("data", data);
        return body.toString();
    }

    private String error(String code, String message) {
        return mapper.createObjectNode().put("success", false).put("code", code).put("message", message).toString();
    }

    private void respond(HttpExchange exchange, String body) throws IOException {
        respond(exchange, 200, body);
    }

    private void respond(HttpExchange exchange, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        try (var output = exchange.getResponseBody()) {
            output.write(bytes);
        }
    }
}
