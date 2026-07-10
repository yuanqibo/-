package team.acg.access.assets.auth;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.Collection;
import java.util.stream.Collectors;

@Service
public class RequestIdentityService {
    private static final String ATTRIBUTE = RequestIdentityService.class.getName() + ".identity";
    private final ObjectProvider<EcpIdentityService> identityService;

    public RequestIdentityService(ObjectProvider<EcpIdentityService> identityService) {
        this.identityService = identityService;
    }

    public Optional<Identity> current(HttpServletRequest request) {
        Object cached = request.getAttribute(ATTRIBUTE);
        if (cached instanceof Identity identity) return Optional.of(identity);

        EcpIdentityService service = identityService.getIfAvailable();
        if (service == null) return Optional.empty();

        String authorization = request.getHeader(HttpHeaders.AUTHORIZATION);
        if (authorization == null || !authorization.startsWith("Bearer ")) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "ECP bearer token is required");
        }
        String token = authorization.substring(7).trim();
        if (token.isBlank()) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "ECP bearer token is required");

        try {
            Identity identity = Identity.from(service.resolve(token));
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
            if (!identity.permissions().contains(permission)) {
                throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Permission is required: " + permission);
            }
        });
    }

    private String required(String value) {
        if (value == null || value.isBlank()) throw new IllegalArgumentException("User identity is required");
        return value.trim();
    }

    public record Identity(String name, String account, String department, String roleCode, Set<String> permissions) {
        static Identity from(Map<String, Object> user) {
            String name = text(user.get("name"));
            String account = text(user.get("account"));
            if (name.isBlank() || account.isBlank()) {
                throw new IllegalStateException("ECP identity is incomplete");
            }
            Set<String> permissions = user.get("permissionCodes") instanceof Collection<?> values
                ? values.stream().map(Object::toString).collect(Collectors.toUnmodifiableSet()) : Set.of();
            return new Identity(name, account, text(user.get("department")), text(user.get("roleCode")), permissions);
        }

        public boolean manager() {
            return "admin".equals(roleCode) || "super_admin".equals(roleCode);
        }

        private static String text(Object value) {
            return value == null ? "" : value.toString().trim();
        }
    }
}
