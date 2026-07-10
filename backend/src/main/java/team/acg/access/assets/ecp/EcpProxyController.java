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
import java.util.Map;

@RestController
public class EcpProxyController {
    private static final int MAX_REQUEST_BODY_BYTES = 64 * 1024;
    private static final Map<String, Set<String>> ALLOWED_ENDPOINTS = Map.of(
        "/public/session", Set.of("GET"),
        "/public/permissions", Set.of("GET"),
        "/public/session/logout", Set.of("POST"),
        "/public/session/permissions/check", Set.of("POST"),
        "/scopes/profiles", Set.of("GET"));
    private static final Set<String> EXCLUDED_REQUEST_HEADERS = Set.of(
        "accept-encoding", "connection", "content-length", "host", "origin", "referer", "transfer-encoding");
    private static final Set<String> EXCLUDED_RESPONSE_HEADERS = Set.of(
        "connection", "content-length", "content-encoding", "keep-alive", "transfer-encoding");

    private final HttpClient client = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(10))
        .followRedirects(HttpClient.Redirect.NEVER)
        .build();
    private final String baseUrl;

    public EcpProxyController(@Value("${asset-portal.ecp-api-base-url}") String baseUrl) {
        this.baseUrl = baseUrl.replaceAll("/$", "");
    }

    @RequestMapping({"/api/v1", "/api/v1/**"})
    public ResponseEntity<byte[]> proxy(HttpServletRequest servletRequest) throws Exception {
        String suffix = servletRequest.getRequestURI().substring("/api/v1".length());
        String path = suffix.isEmpty() ? "/" : suffix;
        if (!isAllowed(path, servletRequest.getMethod())) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(new byte[0]);
        }
        String query = servletRequest.getQueryString() == null ? "" : "?" + servletRequest.getQueryString();
        HttpRequest.Builder request = HttpRequest.newBuilder(URI.create(baseUrl + path + query))
            .timeout(Duration.ofSeconds(30));

        servletRequest.getHeaderNames().asIterator().forEachRemaining(name -> {
            if (!name.startsWith(":") && !EXCLUDED_REQUEST_HEADERS.contains(name.toLowerCase())) {
                servletRequest.getHeaders(name).asIterator().forEachRemaining(value -> request.header(name, value));
            }
        });
        request.header("X-Forwarded-Host", servletRequest.getServerName() + forwardedPort(servletRequest));
        request.header("X-Forwarded-Proto", servletRequest.getScheme());
        request.header("Accept-Encoding", "identity");
        byte[] body = servletRequest.getInputStream().readNBytes(MAX_REQUEST_BODY_BYTES + 1);
        if (body.length > MAX_REQUEST_BODY_BYTES) {
            return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE).body(new byte[0]);
        }
        request.method(servletRequest.getMethod(), body.length == 0
            ? HttpRequest.BodyPublishers.noBody()
            : HttpRequest.BodyPublishers.ofByteArray(body));

        HttpResponse<byte[]> upstream = client.send(request.build(), HttpResponse.BodyHandlers.ofByteArray());
        HttpHeaders headers = new HttpHeaders();
        upstream.headers().map().forEach((name, values) -> {
            if (!name.startsWith(":") && !EXCLUDED_RESPONSE_HEADERS.contains(name.toLowerCase())) {
                headers.put(name, values);
            }
        });
        return ResponseEntity.status(upstream.statusCode()).headers(headers).body(upstream.body());
    }

    private String forwardedPort(HttpServletRequest request) {
        int port = request.getServerPort();
        boolean defaultPort = (request.isSecure() && port == 443) || (!request.isSecure() && port == 80);
        return defaultPort ? "" : ":" + port;
    }

    private boolean isAllowed(String path, String method) {
        if (ALLOWED_ENDPOINTS.getOrDefault(path, Set.of()).contains(method)) return true;
        if ("GET".equals(method) && path.equals("/public/login/domain/context")) return true;
        if (path.matches("/public/login/apps/[A-Za-z0-9_-]{1,64}(/menus)?")) return "GET".equals(method);
        if (path.matches("/public/login/apps/[A-Za-z0-9_-]{1,64}/(feishu-authorizations|sessions|otp-codes|password-resets)")) {
            return "POST".equals(method);
        }
        return path.matches("/public/password-resets/[A-Za-z0-9._~-]{1,512}")
            && ("GET".equals(method) || "POST".equals(method));
    }
}
