package team.acg.access.assets.ecp;

import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class EcpSecurityPolicyTest {
    @Test
    void requiresTheApplicationSecretWhenEcpIsEnabled() {
        EcpSecurityPolicy missingAppSecret = policy(true, "WLY5YG", "", "tenant-1", false);

        assertThatThrownBy(missingAppSecret::validate)
            .isInstanceOf(IllegalStateException.class).hasMessageContaining("ECP_APP_SECRET");
    }

    @Test
    void treatsTheDeploymentTenantAsOptionalRestriction() {
        EcpSecurityPolicy missingTenant = policy(true, "WLY5YG", "app", "", false);

        missingTenant.validate();

        assertThat(missingTenant.tenantRestrictionEnabled()).isFalse();
    }

    @Test
    void rejectsAnUnexpectedApplicationCode() {
        EcpSecurityPolicy policy = policy(true, "OTHER_APP", "app", "tenant-1", false);

        assertThatThrownBy(policy::validate)
            .isInstanceOf(IllegalStateException.class).hasMessageContaining("WLY5YG");
    }

    @Test
    void onlyEnablesTheUnauthenticatedBypassInsideTheTestProfile() {
        MockEnvironment testEnvironment = new MockEnvironment();
        testEnvironment.setActiveProfiles("test");
        EcpSecurityPolicy testPolicy = new EcpSecurityPolicy(
            false, "WLY5YG", "", "", true, testEnvironment);
        testPolicy.validate();

        assertThat(testPolicy.testBypassEnabled()).isTrue();
        assertThatThrownBy(() -> policy(false, "WLY5YG", "", "", true).validate())
            .isInstanceOf(IllegalStateException.class).hasMessageContaining("test profile");
    }

    private EcpSecurityPolicy policy(boolean enabled, String appCode, String appSecret, String tenantId, boolean testBypass) {
        return new EcpSecurityPolicy(
            enabled, appCode, appSecret, tenantId, testBypass, new MockEnvironment());
    }
}
