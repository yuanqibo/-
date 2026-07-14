package team.acg.access.assets.ecp;

import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import org.springframework.stereotype.Component;

@Component
public class EcpSecurityPolicy {
    static final String APP_CODE = "WLY5YG";

    private final boolean enabled;
    private final String appCode;
    private final String appSecret;
    private final String tenantId;
    private final boolean allowUnauthenticatedApiForTests;
    private final Environment environment;

    public EcpSecurityPolicy(
        @Value("${ecp.sdk.enabled:true}") boolean enabled,
        @Value("${ecp.sdk.app-code:}") String appCode,
        @Value("${ecp.sdk.app-secret:}") String appSecret,
        @Value("${asset-portal.security.tenant-id:}") String tenantId,
        @Value("${asset-portal.security.allow-unauthenticated-api-for-tests:false}") boolean allowUnauthenticatedApiForTests,
        Environment environment
    ) {
        this.enabled = enabled;
        this.appCode = appCode;
        this.appSecret = appSecret;
        this.tenantId = trim(tenantId);
        this.allowUnauthenticatedApiForTests = allowUnauthenticatedApiForTests;
        this.environment = environment;
    }

    @PostConstruct
    void validate() {
        if (allowUnauthenticatedApiForTests && !isTestProfile()) {
            throw new IllegalStateException("Unauthenticated business API access is restricted to the test profile");
        }
        if (!enabled) return;
        if (!APP_CODE.equals(trim(appCode))) {
            throw new IllegalStateException("ECP SDK app-code must be " + APP_CODE);
        }
        if (trim(appSecret).isEmpty()) {
            throw new IllegalStateException("ECP_APP_SECRET is required when ECP SDK is enabled");
        }
    }

    public boolean enabled() {
        return enabled;
    }

    public boolean testBypassEnabled() {
        return !enabled && allowUnauthenticatedApiForTests && isTestProfile();
    }

    public String tenantId() {
        return tenantId;
    }

    public boolean tenantRestrictionEnabled() {
        return !tenantId.isEmpty();
    }

    private boolean isTestProfile() {
        return environment.acceptsProfiles(Profiles.of("test"));
    }

    private static String trim(String value) {
        return value == null ? "" : value.trim();
    }
}
