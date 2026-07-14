package team.acg.access.assets.systemconfig;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class SystemConfigSecretCipherTest {
    private static final String VALID_KEY = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";

    @Test
    void requiresAValidKeyWhenEcpProductionSecurityIsEnabled() {
        assertThatThrownBy(() -> new SystemConfigSecretCipher("", true).validateConfiguration())
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("ASSET_PORTAL_SYSTEM_CONFIG_ENCRYPTION_KEY");
        assertThatThrownBy(() -> new SystemConfigSecretCipher("not-base64", true).validateConfiguration())
            .isInstanceOf(IllegalStateException.class);
        assertThatCode(() -> new SystemConfigSecretCipher(VALID_KEY, true).validateConfiguration())
            .doesNotThrowAnyException();
    }

    @Test
    void permitsAnEmptyKeyOnlyWhenEcpIsDisabledForTests() {
        assertThatCode(() -> new SystemConfigSecretCipher("", false).validateConfiguration())
            .doesNotThrowAnyException();
    }
}
