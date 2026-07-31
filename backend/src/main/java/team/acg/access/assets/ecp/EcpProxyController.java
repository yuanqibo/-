package team.acg.access.assets.ecp;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.util.UriComponentsBuilder;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Set;
import java.util.Map;
import java.util.Locale;
import team.acg.access.assets.auth.EcpIdentityService;
import team.acg.access.assets.auth.RequestIdentityService;

@RestController
public class EcpProxyController {
    private static final int MAX_REQUEST_BODY_BYTES = 64 * 1024;
    private static final Map<String, Set<String>> ALLOWED_ENDPOINTS = Map.of(
        "/public/session", Set.of("GET"),
        "/public/permissions", Set.of("GET"),
        "/public/session/logout", Set.of("POST"),
        "/public/session/permissions/check", Set.of("POST"),
        "/scopes", Set.of("GET"),
        "/scopes/profiles", Set.of("GET"),
        "/role-types", Set.of("GET"),
        "/authz/decisions/explain", Set.of("POST"));
    private static final Set<String> EXCLUDED_REQUEST_HEADERS = Set.of(
        "accept-encoding", "connection", "content-length", "host", "origin", "referer", "transfer-encoding");
    private static final Set<String> EXCLUDED_RESPONSE_HEADERS = Set.of(
        "connection", "content-length", "content-encoding", "keep-alive", "transfer-encoding");

    private final HttpClient client = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(10))
        .followRedirects(HttpClient.Redirect.NEVER)
        .build();
    private final String baseUrl;
    private final String appCode;
    private final ObjectProvider<EcpIdentityService> identityCacheProvider;
    private final RequestIdentityService identityService;

    public EcpProxyController(@Value("${asset-portal.ecp-api-base-url}") String baseUrl,
                              @Value("${ecp.sdk.app-code}") String appCode,
                              ObjectProvider<EcpIdentityService> identityCacheProvider,
                              RequestIdentityService identityService) {
        this.baseUrl = baseUrl.replaceAll("/$", "");
        if (!EcpSecurityPolicy.APP_CODE.equals(appCode)) {
            throw new IllegalArgumentException("ECP proxy app-code must be " + EcpSecurityPolicy.APP_CODE);
        }
        this.appCode = appCode;
        this.identityCacheProvider = identityCacheProvider;
        this.identityService = identityService;
    }

    @RequestMapping({"/api/v1", "/api/v1/**"})
    public ResponseEntity<byte[]> proxy(HttpServletRequest servletRequest) throws Exception {
        String suffix = servletRequest.getRequestURI().substring("/api/v1".length());
        String path = suffix.isEmpty() ? "/" : suffix;
        if (!isAllowed(path, servletRequest.getMethod())) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(new byte[0]);
        }
        if (hasForeignAppCode(servletRequest.getQueryString())) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(new byte[0]);
        }
        boolean roleMutation = authorizeRoleMutation(servletRequest, path);
        byte[] body = servletRequest.getInputStream().readNBytes(MAX_REQUEST_BODY_BYTES + 1);
        if (body.length > MAX_REQUEST_BODY_BYTES) {
            return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE).body(new byte[0]);
        }
        String upstreamPath = managedAssignmentPath(path, servletRequest.getMethod());
        String query = servletRequest.getQueryString() == null ? "" : "?" + servletRequest.getQueryString();
        HttpRequest.Builder request = HttpRequest.newBuilder(URI.create(baseUrl + upstreamPath + query))
            .timeout(Duration.ofSeconds(30));

        servletRequest.getHeaderNames().asIterator().forEachRemaining(name -> {
            if (!name.startsWith(":") && !EXCLUDED_REQUEST_HEADERS.contains(name.toLowerCase())) {
                servletRequest.getHeaders(name).asIterator().forEachRemaining(value -> request.header(name, value));
            }
        });
        request.header("X-Forwarded-Host", servletRequest.getServerName() + forwardedPort(servletRequest));
        request.header("X-Forwarded-Proto", servletRequest.getScheme());
        request.header("Accept-Encoding", "identity");
        request.method(servletRequest.getMethod(), body.length == 0
            ? HttpRequest.BodyPublishers.noBody()
            : HttpRequest.BodyPublishers.ofByteArray(body));

        HttpResponse<byte[]> upstream = client.send(request.build(), HttpResponse.BodyHandlers.ofByteArray());
        if (roleMutation && upstream.statusCode() >= 200 && upstream.statusCode() < 300) {
            EcpIdentityService identityCache = identityCacheProvider.getIfAvailable();
            if (identityCache != null) identityCache.invalidateAll();
        }
        HttpHeaders headers = new HttpHeaders();
        upstream.headers().map().forEach((name, values) -> {
            if (!name.startsWith(":") && !EXCLUDED_RESPONSE_HEADERS.contains(name.toLowerCase())) {
                headers.put(name, values);
            }
        });
        return ResponseEntity.status(upstream.statusCode()).headers(headers).body(upstream.body());
    }

    private boolean authorizeRoleMutation(HttpServletRequest request, String path) {
        String applicationPath = "/applications/" + appCode;
        String method = request.getMethod();

        if (path.equals(applicationPath + "/app-role-assignments") && "POST".equals(method)) {
            identityService.requirePermission(request, "authz:app_role:assign");
        } else if (path.equals(applicationPath + "/app-role-assignment-subjects") && "PUT".equals(method)) {
            identityService.requirePermission(request, "authz:app_role:assign");
        } else if (path.equals(applicationPath + "/app-role-assignments/batch-remove") && "POST".equals(method)) {
            identityService.requirePermission(request, "authz:app_role:assign");
        } else if (path.equals(applicationPath + "/app-roles") && "POST".equals(method)) {
            identityService.requirePermission(request, "authz:app_role:create");
        } else if (path.matches(java.util.regex.Pattern.quote(applicationPath) + "/app-roles/[A-Za-z0-9_-]{1,64}")) {
            if ("PUT".equals(method)) {
                identityService.requirePermission(request, "authz:app_role:update");
            } else if ("DELETE".equals(method)) {
                identityService.requirePermission(request, "authz:app_role:delete");
            } else {
                return false;
            }
        } else {
            return false;
        }
        return true;
    }

    private String managedAssignmentPath(String path, String method) {
        String applicationPath = "/applications/" + appCode;
        if ("POST".equals(method) && path.equals(applicationPath + "/app-role-assignments")) {
            return applicationPath + "/managed-app-role-assignments";
        }
        if ("PUT".equals(method) && path.equals(applicationPath + "/app-role-assignment-subjects")) {
            return applicationPath + "/managed-app-role-assignment-subjects";
        }
        if ("POST".equals(method) && path.equals(applicationPath + "/app-role-assignments/batch-remove")) {
            return applicationPath + "/managed-app-role-assignments/batch-remove";
        }
        return path;
    }

    private String forwardedPort(HttpServletRequest request) {
        int port = request.getServerPort();
        boolean defaultPort = (request.isSecure() && port == 443) || (!request.isSecure() && port == 80);
        return defaultPort ? "" : ":" + port;
    }

    private boolean isAllowed(String path, String method) {
        if (ALLOWED_ENDPOINTS.getOrDefault(path, Set.of()).contains(method)) return true;
        if ("GET".equals(method) && path.equals("/public/login/domain/context")) return true;
        String loginAppPath = "/public/login/apps/" + appCode;
        if (path.equals(loginAppPath) || path.equals(loginAppPath + "/menus")) return "GET".equals(method);
        if (Set.of("/feishu-authorizations", "/sessions", "/otp-codes", "/password-resets").stream()
            .anyMatch(suffix -> path.equals(loginAppPath + suffix))) {
            return "POST".equals(method);
        }
        String applicationPath = "/applications/" + appCode;
        if (path.equals(applicationPath)
            || path.equals(applicationPath + "/selectable-accounts")
            || path.equals(applicationPath + "/selectable-departments")
            || path.equals(applicationPath + "/catalog/versions")
            || path.matches(java.util.regex.Pattern.quote(applicationPath) + "/catalog/versions/[0-9]{1,18}")) {
            return "GET".equals(method);
        }
        if (path.equals(applicationPath + "/app-roles")) {
            return "GET".equals(method) || "POST".equals(method);
        }
        if (path.matches(java.util.regex.Pattern.quote(applicationPath) + "/app-roles/[A-Za-z0-9_-]{1,64}")) {
            return "PUT".equals(method) || "DELETE".equals(method);
        }
        if (path.equals(applicationPath + "/app-role-assignments")) {
            return "GET".equals(method) || "POST".equals(method);
        }
        if (path.equals(applicationPath + "/app-role-assignment-subjects")) {
            return "PUT".equals(method);
        }
        if (path.equals(applicationPath + "/app-role-assignments/batch-remove")) {
            return "POST".equals(method);
        }
        return path.matches("/public/password-resets/[A-Za-z0-9._~-]{1,512}")
            && ("GET".equals(method) || "POST".equals(method));
    }

    private boolean hasForeignAppCode(String query) {
        if (query == null || query.isBlank()) return false;
        var parameters = UriComponentsBuilder.fromUriString("/?" + query).build().getQueryParams();
        return parameters.entrySet().stream().anyMatch(entry -> {
            String key = entry.getKey().replace("_", "").replace("-", "").toLowerCase(Locale.ROOT);
            if (!Set.of("appcode", "applicationcode").contains(key)) return false;
            return entry.getValue().isEmpty() || entry.getValue().stream().anyMatch(value -> !appCode.equals(value));
        });
    }
}
