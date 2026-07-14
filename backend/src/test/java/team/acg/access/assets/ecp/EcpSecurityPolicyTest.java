package team.acg.access.assets.ecp;

import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class EcpSecurityPolicyTest {
    @Test
    void requiresBothServerSecretsWhenEcpIsEnabled() {
        EcpSecurityPolicy missingAppSecret = policy(true, "WLY5YG", "", "snapshot", "tenant-1", false);
        EcpSecurityPolicy missingSnapshotSecret = policy(true, "WLY5YG", "app", "", "tenant-1", false);

        assertThatThrownBy(missingAppSecret::validate)
            .isInstanceOf(IllegalStateException.class).hasMessageContaining("ECP_APP_SECRET");
        assertThatThrownBy(missingSnapshotSecret::validate)
            .isInstanceOf(IllegalStateException.class).hasMessageContaining("SNAPSHOT_SIGNING_SECRET");
    }

    @Test
    void requiresDeploymentTenantWhenEcpIsEnabled() {
        EcpSecurityPolicy missingTenant = policy(true, "WLY5YG", "app", "snapshot", "", false);

        assertThatThrownBy(missingTenant::validate)
            .isInstanceOf(IllegalStateException.class).hasMessageContaining("ECP_TENANT_ID");
    }

    @Test
    void rejectsAnUnexpectedApplicationCode() {
        EcpSecurityPolicy policy = policy(true, "OTHER_APP", "app", "snapshot", "tenant-1", false);

        assertThatThrownBy(policy::validate)
            .isInstanceOf(IllegalStateException.class).hasMessageContaining("WLY5YG");
    }

    @Test
    void onlyEnablesTheUnauthenticatedBypassInsideTheTestProfile() {
        MockEnvironment testEnvironment = new MockEnvironment();
        testEnvironment.setActiveProfiles("test");
        EcpSecurityPolicy testPolicy = new EcpSecurityPolicy(
            false, "WLY5YG", "", "", "", true, testEnvironment);
        testPolicy.validate();

        assertThat(testPolicy.testBypassEnabled()).isTrue();
        assertThatThrownBy(() -> policy(false, "WLY5YG", "", "", "", true).validate())
            .isInstanceOf(IllegalStateException.class).hasMessageContaining("test profile");
    }

    private EcpSecurityPolicy policy(boolean enabled, String appCode, String appSecret,
                                     String snapshotSecret, String tenantId, boolean testBypass) {
        return new EcpSecurityPolicy(
            enabled, appCode, appSecret, snapshotSecret, tenantId, testBypass, new MockEnvironment());
    }
}
