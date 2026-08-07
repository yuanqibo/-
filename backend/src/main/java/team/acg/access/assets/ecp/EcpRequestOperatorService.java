package team.acg.access.assets.ecp;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.idanchuang.ecp.sdk.spring.session.SessionTokenResolver;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import team.acg.access.assets.auth.RequestIdentityService;
import team.acg.access.assets.store.AppStoreRepository;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

@Service
@ConditionalOnProperty(prefix = "ecp.sdk", name = "enabled", havingValue = "true")
public class EcpRequestOperatorService {
    private static final Logger log = LoggerFactory.getLogger(EcpRequestOperatorService.class);
    private static final String REVIEW_PERMISSION = "asset:request:review";
    private static final String ROLE_VIEW_PERMISSION = "authz:app_role:view";
    private static final String STORE_KEY = "assetPortalRequestOperatorsV1";
    private static final TypeReference<List<RequestOperator>> OPERATOR_LIST = new TypeReference<>() {};
    private final HttpClient client = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(10))
        .followRedirects(HttpClient.Redirect.NEVER)
        .build();
    private final String rolesUrl;
    private final AppStoreRepository store;
    private final ObjectMapper mapper;
    private final ObjectProvider<SessionTokenResolver> sessionTokenResolver;
    private final RequestIdentityService identityService;

    public EcpRequestOperatorService(@Value("${asset-portal.ecp-api-base-url}") String baseUrl,
                                     @Value("${ecp.sdk.app-code}") String appCode,
                                     AppStoreRepository store,
                                     ObjectMapper mapper,
                                     ObjectProvider<SessionTokenResolver> sessionTokenResolver,
                                     RequestIdentityService identityService) {
        String normalizedBaseUrl = text(baseUrl).replaceAll("/+$", "");
        if (normalizedBaseUrl.isBlank()) throw new IllegalArgumentException("ECP API base URL is required");
        if (!EcpSecurityPolicy.APP_CODE.equals(appCode)) {
            throw new IllegalArgumentException("ECP request operator app-code must be " + EcpSecurityPolicy.APP_CODE);
        }
        this.rolesUrl = normalizedBaseUrl + "/applications/" + encode(appCode) + "/app-roles";
        this.store = store;
        this.mapper = mapper;
        this.sessionTokenResolver = sessionTokenResolver;
        this.identityService = identityService;
    }

    public List<RequestOperator> list() {
        return stored();
    }

    public List<RequestOperator> list(HttpServletRequest request) {
        List<RequestOperator> current = stored();
        boolean canRefresh = identityService.current(request)
            .map(identity -> identity.hasPermission(ROLE_VIEW_PERMISSION))
            .orElse(false);
        if (!canRefresh) return current;

        String token = sessionToken(request);
        try {
            return refresh(token);
        } catch (EcpRoleRequestException error) {
            log.warn("Unable to refresh ECP request operators; status={}, code={}, message={}",
                error.statusCode(), error.errorCode(), error.getMessage());
            if (current.isEmpty()) throw error;
            return current;
        }
    }

    public List<RequestOperator> refresh(String sessionToken) {
        String normalized = normalizeToken(sessionToken);
        if (normalized.isBlank()) throw new IllegalArgumentException("ECP session token is required");

        List<Role> roles = nodes(requestJson(rolesUrl, normalized), "roles").stream()
            .map(EcpRequestOperatorService::role)
            .filter(EcpRequestOperatorService::canReviewRequests)
            .toList();
        Map<String, RequestOperator> operators = new LinkedHashMap<>();
        for (Role role : roles) {
            String assignmentsUrl = rolesUrl.substring(0, rolesUrl.length() - "/app-roles".length())
                + "/app-role-assignments?appRoleId=" + encode(role.id());
            for (JsonNode assignment : nodes(requestJson(assignmentsUrl, normalized), "assignments")) {
                if (!"ACCOUNT".equalsIgnoreCase(first(assignment, "subjectType", "subject_type", "nodeType"))) {
                    continue;
                }
                String subject = accountSubject(first(assignment,
                    "subjectKey", "subject_key", "subject", "subjectAccountId", "accountUnionId"));
                String name = first(assignment, "subjectLabel", "subject_label", "name", "displayName");
                if (subject.isBlank() || name.isBlank()) continue;
                operators.putIfAbsent(subject.toLowerCase(Locale.ROOT), new RequestOperator(
                    subject,
                    name,
                    first(assignment, "companyName", "company_name"),
                    first(assignment, "departmentName", "department_name", "primaryDepartmentName")));
            }
        }
        List<RequestOperator> result = List.copyOf(operators.values());
        store.saveAll(Map.of(STORE_KEY, mapper.valueToTree(result)));
        log.info("Refreshed ECP request operator snapshot (roles={}, operators={})", roles.size(), result.size());
        return result;
    }

    private JsonNode requestJson(String url, String sessionToken) {
        HttpRequest request = HttpRequest.newBuilder(URI.create(url))
            .timeout(Duration.ofSeconds(30))
            .header(HttpHeaders.AUTHORIZATION, "Bearer " + sessionToken)
            .header(HttpHeaders.ACCEPT, MediaType.APPLICATION_JSON_VALUE)
            .header(HttpHeaders.ACCEPT_ENCODING, "identity")
            .GET()
            .build();
        try {
            HttpResponse<byte[]> response = client.send(request, HttpResponse.BodyHandlers.ofByteArray());
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                throw remoteError(response.statusCode(), response.body());
            }
            return mapper.readTree(response.body());
        } catch (EcpRoleRequestException error) {
            throw error;
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw new EcpRoleRequestException(502, "INTERRUPTED", "ECP role request was interrupted", error);
        } catch (IOException | IllegalArgumentException error) {
            throw new EcpRoleRequestException(502, "UPSTREAM_ERROR", "ECP role request failed", error);
        }
    }

    private EcpRoleRequestException remoteError(int statusCode, byte[] body) {
        String code = "HTTP_" + statusCode;
        String message = "ECP role request failed";
        try {
            JsonNode response = mapper.readTree(body);
            String responseCode = first(response, "code", "errorCode", "error_code");
            String responseMessage = first(response, "message", "errorMessage", "error_message");
            if (!responseCode.isBlank()) code = responseCode;
            if (!responseMessage.isBlank()) message = responseMessage;
        } catch (IOException ignored) {
            // Keep the sanitized fallback instead of logging an arbitrary upstream body.
        }
        return new EcpRoleRequestException(statusCode, code, message, null);
    }

    private List<RequestOperator> stored() {
        return store.find(STORE_KEY).map(value -> {
            try {
                return List.copyOf(mapper.convertValue(value.value(), OPERATOR_LIST));
            } catch (IllegalArgumentException error) {
                log.warn("Stored ECP request operator snapshot is invalid", error);
                return List.<RequestOperator>of();
            }
        }).orElseGet(List::of);
    }

    private String sessionToken(HttpServletRequest request) {
        SessionTokenResolver resolver = sessionTokenResolver.getIfAvailable();
        return resolver == null ? "" : normalizeToken(resolver.resolveSessionToken(request));
    }

    private static List<JsonNode> nodes(JsonNode root, String domainKey) {
        if (root == null || root.isNull()) return List.of();
        JsonNode current = root.has("data") ? root.path("data") : root;
        if (current.isArray()) return iterable(current);
        for (String key : List.of(domainKey, "items", "content", "records", "list")) {
            if (current.path(key).isArray()) return iterable(current.path(key));
        }
        if (current.isObject() && current.path(domainKey).path("items").isArray()) {
            return iterable(current.path(domainKey).path("items"));
        }
        return List.of();
    }

    private static List<JsonNode> iterable(JsonNode array) {
        List<JsonNode> values = new ArrayList<>();
        array.forEach(values::add);
        return values;
    }

    private static Role role(JsonNode node) {
        return new Role(
            first(node, "id", "appRoleId", "app_role_id"),
            first(node, "code", "roleCode", "role_code"),
            first(node, "roleTypeCode", "role_type_code", "type"),
            first(node, "status"),
            strings(node, "effectivePermissionCodes", "effective_permission_codes", "permissionCodes"));
    }

    private static Set<String> strings(JsonNode node, String... fields) {
        Set<String> values = new LinkedHashSet<>();
        for (String field : fields) {
            JsonNode candidate = node.path(field);
            if (candidate.isArray()) candidate.forEach(value -> {
                String normalized = text(value.asText());
                if (!normalized.isBlank()) values.add(normalized);
            });
        }
        return Set.copyOf(values);
    }

    private static boolean canReviewRequests(Role role) {
        if (role.id().isBlank() || "disabled".equalsIgnoreCase(role.status())) return false;
        if (role.permissions().contains(REVIEW_PERMISSION)) return true;
        String code = role.code().toUpperCase(Locale.ROOT);
        String type = role.type().toUpperCase(Locale.ROOT);
        return "APP_ADMIN".equals(code) || "APP_ADMIN".equals(type)
            || "OPERATOR".equals(code) || "OPERATOR".equals(type);
    }

    private static String first(JsonNode node, String... fields) {
        if (node == null) return "";
        for (String field : fields) {
            JsonNode value = node.path(field);
            if (value.isValueNode()) {
                String normalized = text(value.asText());
                if (!normalized.isBlank() && !"null".equalsIgnoreCase(normalized)) return normalized;
            }
        }
        return "";
    }

    private static String accountSubject(String value) {
        String normalized = text(value);
        return normalized.regionMatches(true, 0, "account:", 0, 8)
            ? normalized.substring(8).trim() : normalized;
    }

    private static String normalizeToken(String token) {
        String normalized = text(token);
        return normalized.regionMatches(true, 0, "Bearer ", 0, 7)
            ? normalized.substring(7).trim() : normalized;
    }

    private static String encode(String value) {
        return URLEncoder.encode(text(value), StandardCharsets.UTF_8).replace("+", "%20");
    }

    private static String text(Object value) {
        return value == null ? "" : value.toString().trim();
    }

    private record Role(String id, String code, String type, String status, Set<String> permissions) {}

    private static final class EcpRoleRequestException extends RuntimeException {
        private final int statusCode;
        private final String errorCode;

        private EcpRoleRequestException(int statusCode, String errorCode, String message, Throwable cause) {
            super(message, cause);
            this.statusCode = statusCode;
            this.errorCode = errorCode;
        }

        private int statusCode() {
            return statusCode;
        }

        private String errorCode() {
            return errorCode;
        }
    }

    public record RequestOperator(String subject, String name, String company, String department) {}
}
