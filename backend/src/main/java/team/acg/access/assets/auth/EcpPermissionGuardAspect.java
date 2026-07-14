package team.acg.access.assets.auth;

import com.idanchuang.ecp.sdk.client.exception.EcpPermissionDeniedException;
import com.idanchuang.ecp.sdk.spring.annotation.PermissionSpec;
import com.idanchuang.ecp.sdk.spring.annotation.RequireAllPermissions;
import com.idanchuang.ecp.sdk.spring.annotation.RequireAnyPermission;
import com.idanchuang.ecp.sdk.spring.annotation.RequirePermission;
import jakarta.servlet.http.HttpServletRequest;
import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.annotation.Before;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

import java.util.Arrays;
import java.util.List;
import java.util.Objects;

@Aspect
@Component
@ConditionalOnProperty(prefix = "ecp.sdk", name = "enabled", havingValue = "true")
public class EcpPermissionGuardAspect {
    private final ObjectProvider<HttpServletRequest> requestProvider;
    private final RequestIdentityService identityService;

    public EcpPermissionGuardAspect(ObjectProvider<HttpServletRequest> requestProvider,
                                    RequestIdentityService identityService) {
        this.requestProvider = requestProvider;
        this.identityService = identityService;
    }

    @Before("@annotation(requirePermission)")
    public void requirePermission(RequirePermission requirePermission) {
        requireAll(nonBlank(requirePermission.permissions()));
    }

    @Before("@annotation(requireAnyPermission)")
    public void requireAnyPermission(RequireAnyPermission requireAnyPermission) {
        requireAny(specValues(requireAnyPermission.value()));
    }

    @Before("@annotation(requireAllPermissions)")
    public void requireAllPermissions(RequireAllPermissions requireAllPermissions) {
        requireAll(specValues(requireAllPermissions.value()));
    }

    private void requireAll(List<String> required) {
        if (required.isEmpty()) return;
        RequestIdentityService.Identity identity = currentIdentity();
        List<String> matched = required.stream().filter(identity::hasPermission).toList();
        if (matched.size() != required.size()) {
            throw denied(required, matched, "ALL");
        }
    }

    private void requireAny(List<String> required) {
        if (required.isEmpty()) return;
        RequestIdentityService.Identity identity = currentIdentity();
        List<String> matched = required.stream().filter(identity::hasPermission).toList();
        if (matched.isEmpty()) {
            throw denied(required, matched, "ANY");
        }
    }

    private RequestIdentityService.Identity currentIdentity() {
        HttpServletRequest request = requestProvider.getIfAvailable();
        if (request == null) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "ECP bearer token is required");
        }
        return identityService.current(request).orElseThrow(
            () -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "ECP bearer token is required"));
    }

    private EcpPermissionDeniedException denied(List<String> required, List<String> matched, String matchMode) {
        return new EcpPermissionDeniedException(
            403,
            "ECP_PERMISSION_DENIED",
            "ECP permission denied",
            "",
            "",
            required,
            matched,
            required,
            matchMode,
            "SESSION_CONTEXT",
            "MISSING_PERMISSION");
    }

    private List<String> specValues(PermissionSpec[] specs) {
        return Arrays.stream(specs).filter(Objects::nonNull)
            .map(PermissionSpec::value).filter(Objects::nonNull).map(String::trim)
            .filter(value -> !value.isEmpty()).distinct().toList();
    }

    private List<String> nonBlank(String[] permissions) {
        return Arrays.stream(permissions).filter(Objects::nonNull).map(String::trim)
            .filter(value -> !value.isEmpty()).distinct().toList();
    }
}
