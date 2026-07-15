package team.acg.access.assets.ecp;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Set;

@RestController
public class EcpControlPlaneProxyController {
    private static final int MAX_REQUEST_BODY_BYTES = 128 * 1024;
    private static final Set<String> EXCLUDED_REQUEST_HEADERS = Set.of(
        "accept-encoding", "connection", "content-length", "host", "origin", "referer", "transfer-encoding");
    private static final Set<String> EXCLUDED_RESPONSE_HEADERS = Set.of(
        "connection", "content-length", "content-encoding", "keep-alive", "transfer-encoding");

    private final HttpClient client = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(10))
        .followRedirects(HttpClient.Redirect.NEVER)
        .build();
    private final String baseUrl;

    public EcpControlPlaneProxyController(@Value("${asset-portal.ecp-api-base-url}") String baseUrl) {
        this.baseUrl = baseUrl.replaceAll("/$", "");
    }

    @RequestMapping({"/api/ecp/control-plane", "/api/ecp/control-plane/**"})
    public ResponseEntity<byte[]> proxy(HttpServletRequest servletRequest) throws Exception {
        String authorization = servletRequest.getHeader(HttpHeaders.AUTHORIZATION);
        if (authorization == null || !authorization.startsWith("Bearer ")) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(json("ECP bearer token is required"));
        }

        String suffix = servletRequest.getRequestURI().substring("/api/ecp/control-plane".length());
        String path = suffix.isEmpty() ? "/" : suffix;
        String method = servletRequest.getMethod();
        if (!isAllowed(path, method)) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(json("ECP control-plane endpoint is not allowed"));
        }

        byte[] body = servletRequest.getInputStream().readNBytes(MAX_REQUEST_BODY_BYTES + 1);
        if (body.length > MAX_REQUEST_BODY_BYTES) {
            return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE).body(json("Request body is too large"));
        }

        String query = servletRequest.getQueryString() == null ? "" : "?" + servletRequest.getQueryString();
        HttpRequest.Builder request = HttpRequest.newBuilder(URI.create(baseUrl + path + query))
            .timeout(Duration.ofSeconds(40));
        servletRequest.getHeaderNames().asIterator().forEachRemaining(name -> {
            if (!name.startsWith(":") && !EXCLUDED_REQUEST_HEADERS.contains(name.toLowerCase())) {
                servletRequest.getHeaders(name).asIterator().forEachRemaining(value -> request.header(name, value));
            }
        });
        request.header("Accept-Encoding", "identity");
        request.method(method, body.length == 0 ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofByteArray(body));

        HttpResponse<byte[]> upstream = client.send(request.build(), HttpResponse.BodyHandlers.ofByteArray());
        HttpHeaders headers = new HttpHeaders();
        upstream.headers().map().forEach((name, values) -> {
            if (!name.startsWith(":") && !EXCLUDED_RESPONSE_HEADERS.contains(name.toLowerCase())) {
                headers.put(name, values);
            }
        });
        return ResponseEntity.status(upstream.statusCode()).headers(headers).body(upstream.body());
    }

    private boolean isAllowed(String path, String method) {
        if ("/iam/account-sets".equals(path)) {
            return Set.of("GET", "POST").contains(method);
        }
        String id = "[A-Za-z0-9._~-]{1,128}";
        if (path.matches("/iam/account-sets/" + id)) {
            return Set.of("GET", "PUT", "PATCH").contains(method);
        }
        if (path.matches("/iam/account-sets/" + id + "/sync")) {
            return "POST".equals(method);
        }
        if (path.matches("/iam/account-sets/" + id + "/sync-config")) {
            return Set.of("GET", "PUT", "PATCH").contains(method);
        }
        if (path.matches("/iam/account-sets/" + id + "/sync-logs")) {
            return "GET".equals(method);
        }
        if (path.matches("/iam/account-sets/" + id + "/integrations?")) {
            return Set.of("GET", "PUT", "PATCH").contains(method);
        }
        return false;
    }

    private byte[] json(String message) {
        return ("{\"error\":\"" + message.replace("\"", "\\\"") + "\"}").getBytes(java.nio.charset.StandardCharsets.UTF_8);
    }
}
