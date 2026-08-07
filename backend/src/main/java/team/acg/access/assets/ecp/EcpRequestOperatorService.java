package team.acg.access.assets.ecp;

import com.idanchuang.ecp.api.common.model.role.ApplicationRole;
import com.idanchuang.ecp.api.common.model.role.ApplicationRoleAssignment;
import com.idanchuang.ecp.sdk.client.EcpClient;
import com.idanchuang.ecp.sdk.client.EcpRequestOptions;
import com.idanchuang.ecp.sdk.client.exception.EcpRemoteException;
import com.idanchuang.ecp.sdk.spring.session.SessionTokenResolver;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Service;
import team.acg.access.assets.auth.RequestIdentityService;
import team.acg.access.assets.store.AppStoreRepository;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

@Service
@ConditionalOnProperty(prefix = "ecp.sdk", name = "enabled", havingValue = "true")
public class EcpRequestOperatorService {
    private static final Logger log = LoggerFactory.getLogger(EcpRequestOperatorService.class);
    private static final String REVIEW_PERMISSION = "asset:request:review";
    private static final String ROLE_VIEW_PERMISSION = "authz:app_role:view";
    private static final String STORE_KEY = "assetPortalRequestOperatorsV1";
    private static final TypeReference<List<RequestOperator>> OPERATOR_LIST = new TypeReference<>() {};
    private final EcpClient client;
    private final AppStoreRepository store;
    private final ObjectMapper mapper;
    private final ObjectProvider<SessionTokenResolver> sessionTokenResolver;
    private final RequestIdentityService identityService;

    public EcpRequestOperatorService(EcpClient client,
                                     AppStoreRepository store,
                                     ObjectMapper mapper,
                                     ObjectProvider<SessionTokenResolver> sessionTokenResolver,
                                     RequestIdentityService identityService) {
        this.client = client;
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
        } catch (EcpRemoteException error) {
            if (current.isEmpty()) throw error;
            log.warn("Unable to refresh ECP request operators; using the persisted snapshot (status={}, code={}, requestId={})",
                error.getStatusCode(), error.getErrorCode(), error.getRequestId());
            return current;
        }
    }

    public List<RequestOperator> refresh(String sessionToken) {
        String normalized = normalizeToken(sessionToken);
        if (normalized.isBlank()) throw new IllegalArgumentException("ECP session token is required");
        EcpClient sessionClient = client.withOptions(EcpRequestOptions.builder()
            .header(HttpHeaders.AUTHORIZATION, "Bearer " + normalized)
            .build());
        List<ApplicationRole> roles = sessionClient.roles().list().stream()
            .filter(EcpRequestOperatorService::canReviewRequests)
            .toList();
        Map<String, RequestOperator> operators = new LinkedHashMap<>();
        for (ApplicationRole role : roles) {
            for (ApplicationRoleAssignment assignment : sessionClient.roles().assignments().list(null, role.id())) {
                if (!"ACCOUNT".equalsIgnoreCase(text(assignment.subjectType()))) continue;
                String subject = subject(assignment);
                String name = text(assignment.subjectLabel());
                if (subject.isBlank() || name.isBlank()) continue;
                operators.putIfAbsent(subject.toLowerCase(Locale.ROOT), new RequestOperator(
                    subject, name, text(assignment.companyName()), text(assignment.departmentName())));
            }
        }
        List<RequestOperator> result = List.copyOf(operators.values());
        store.saveAll(Map.of(STORE_KEY, mapper.valueToTree(result)));
        return result;
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

    private static String normalizeToken(String token) {
        String normalized = text(token);
        return normalized.regionMatches(true, 0, "Bearer ", 0, 7)
            ? normalized.substring(7).trim() : normalized;
    }

    private static boolean canReviewRequests(ApplicationRole role) {
        if (role == null || role.id() == null || "disabled".equalsIgnoreCase(text(role.status()))) return false;
        if (role.effectivePermissionCodes() != null && role.effectivePermissionCodes().contains(REVIEW_PERMISSION)) return true;
        String code = text(role.code()).toUpperCase(Locale.ROOT);
        String type = text(role.roleTypeCode()).toUpperCase(Locale.ROOT);
        return "APP_ADMIN".equals(code) || "APP_ADMIN".equals(type) || "OPERATOR".equals(code) || "OPERATOR".equals(type);
    }

    private static String subject(ApplicationRoleAssignment assignment) {
        String value = text(assignment.subjectKey());
        return value.regionMatches(true, 0, "account:", 0, 8) ? value.substring(8).trim() : value;
    }

    private static String text(Object value) {
        return value == null ? "" : value.toString().trim();
    }

    public record RequestOperator(String subject, String name, String company, String department) {}
}
