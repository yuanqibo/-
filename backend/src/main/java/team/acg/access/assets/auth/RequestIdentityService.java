package team.acg.access.assets.auth;

import com.idanchuang.ecp.sdk.spring.session.SessionTokenResolver;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import team.acg.access.assets.ecp.EcpSecurityPolicy;

import java.util.Collection;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

@Service
public class RequestIdentityService {
    private static final String ATTRIBUTE = RequestIdentityService.class.getName() + ".identity";
    private final ObjectProvider<EcpIdentityService> identityService;
    private final ObjectProvider<SessionTokenResolver> sessionTokenResolver;
    private final EcpSecurityPolicy securityPolicy;

    public RequestIdentityService(ObjectProvider<EcpIdentityService> identityService,
                                  ObjectProvider<SessionTokenResolver> sessionTokenResolver,
                                  EcpSecurityPolicy securityPolicy) {
        this.identityService = identityService;
        this.sessionTokenResolver = sessionTokenResolver;
        this.securityPolicy = securityPolicy;
    }

    public Optional<Identity> current(HttpServletRequest request) {
        Object cached = request.getAttribute(ATTRIBUTE);
        if (cached instanceof Identity identity) return Optional.of(identity);

        EcpIdentityService service = identityService.getIfAvailable();
        if (service == null) {
            if (securityPolicy.testBypassEnabled()) return Optional.empty();
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "ECP server authorization is unavailable");
        }

        SessionTokenResolver resolver = sessionTokenResolver.getIfAvailable();
        if (resolver == null) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "ECP session token resolver is unavailable");
        }
        String token = resolver.resolveSessionToken(request);
        if (token == null || token.isBlank()) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "ECP bearer token is required");
        }

        try {
            Identity identity = Identity.from(service.resolve(token));
            if (identity.tenantId().isBlank()) {
                throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "ECP tenant identity is required");
            }
            if (identity.subject().isBlank() || identity.directorySubject().isBlank()) {
                throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "ECP stable user subject is required");
            }
            if (securityPolicy.tenantRestrictionEnabled()) {
                if (identity.tenantId().isBlank()) {
                    throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "ECP tenant identity is required");
                }
                if (!identity.tenantId().equals(securityPolicy.tenantId())) {
                    throw new ResponseStatusException(HttpStatus.FORBIDDEN, "ECP tenant is not allowed for this deployment");
                }
            }
            request.setAttribute(ATTRIBUTE, identity);
            return Optional.of(identity);
        } catch (ResponseStatusException error) {
            throw error;
        } catch (Exception error) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "ECP session is invalid", error);
        }
    }

    public String trustedName(HttpServletRequest request, String testFallback) {
        return current(request).map(Identity::name).orElseGet(() -> required(testFallback));
    }

    public void requirePermission(HttpServletRequest request, String permission) {
        current(request).ifPresent(identity -> {
            if (!identity.hasPermission(permission)) {
                throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Permission is required: " + permission);
            }
        });
    }

    public void requireAnyPermission(HttpServletRequest request, Collection<String> required) {
        Set<String> permissions = required == null ? Set.of() : required.stream()
            .map(RequestIdentityService::text).filter(value -> !value.isBlank())
            .collect(Collectors.toUnmodifiableSet());
        if (permissions.isEmpty()) throw new IllegalArgumentException("At least one permission is required");
        current(request).ifPresent(identity -> {
            if (!identity.hasAnyPermission(permissions)) {
                throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                    "One of ECP permissions is required: " + String.join(", ", permissions));
            }
        });
    }

    private String required(String value) {
        if (value == null || value.isBlank()) throw new IllegalArgumentException("User identity is required");
        return value.trim();
    }

    private static String text(Object value) {
        return value == null ? "" : value.toString().trim();
    }

    public record Identity(String name, String account, String subject, String directorySubject, String tenantId, String department, String company,
                           Set<String> departmentIds, String roleCode, Set<String> permissions) {
        static Identity from(Map<String, Object> user) {
            String name = text(user.get("name"));
            String account = text(user.get("account"));
            if (name.isBlank() || account.isBlank()) {
                throw new IllegalStateException("ECP identity is incomplete");
            }
            Set<String> permissions = user.get("permissionCodes") instanceof Collection<?> values
                ? values.stream().map(Object::toString).collect(Collectors.toUnmodifiableSet()) : Set.of();
            Set<String> departmentIds = user.get("departmentUnionIds") instanceof Collection<?> values
                ? values.stream().map(Object::toString).collect(Collectors.toUnmodifiableSet()) : Set.of();
            return new Identity(name, account, text(user.get("subject")), text(user.get("directorySubject")), text(user.get("tenantId")),
                text(user.get("department")), text(user.get("company")), departmentIds, text(user.get("roleCode")), permissions);
        }

        public boolean manager() {
            return "admin".equals(roleCode) || "super_admin".equals(roleCode);
        }

        public boolean hasPermission(String permission) {
            return "super_admin".equals(roleCode) || permissions.contains(permission);
        }

        public boolean hasAnyPermission(Set<String> required) {
            return "super_admin".equals(roleCode) || required.stream().anyMatch(permissions::contains);
        }

        private static String text(Object value) {
            return value == null ? "" : value.toString().trim();
        }
    }
}
