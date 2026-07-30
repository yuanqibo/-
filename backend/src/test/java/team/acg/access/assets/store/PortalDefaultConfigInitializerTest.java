package team.acg.access.assets.store;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
@ActiveProfiles("test")
@TestPropertySource(properties = "spring.datasource.url=jdbc:h2:mem:portal-defaults-test;MODE=MySQL;DB_CLOSE_DELAY=-1")
class PortalDefaultConfigInitializerTest {
    @Autowired PortalDefaultConfigInitializer initializer;
    @Autowired AppStoreRepository repository;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper mapper;

    @BeforeEach
    void clearStore() {
        jdbc.update("DELETE FROM app_store");
    }

    @Test
    void initializesRequiredConfigurationWithoutABrowser() {
        assertThat(initializer.initializeMissing()).isEqualTo(7);

        assertThat(repository.find("assetCategoryTree")).isPresent();
        assertThat(repository.find("assetLocationTree")).isPresent();
        assertThat(repository.find("assetCategoryTreeVersion")).isPresent();
        assertThat(repository.find("assetPortalAssetCodeRuleSettingsV1")).isPresent();
        assertThat(repository.find("assetPortalSelfServiceSettingsV9")).isPresent();
        assertThat(repository.find("assetPortalSelfServiceSettingsV9").orElseThrow().value()
            .path("handoverAsset").path("approvalRequired").asBoolean()).isTrue();
        assertThat(repository.find("assetPortalSelfServiceSettingsV9").orElseThrow().value()
            .path("receiveAsset").path("approvalRequired").asBoolean()).isTrue();
        assertThat(repository.find("assetPortalSelfServiceSettingsV9").orElseThrow().value()
            .path("borrowAsset").path("approvalRequired").asBoolean()).isTrue();
        assertThat(repository.find("assetPortalSelfServiceSettingsV9").orElseThrow().value()
            .path("signSettings").path("assetReceive").path("employeeSign").asBoolean()).isFalse();
        assertThat(repository.find("assetPortalSelfServiceSettingsV9").orElseThrow().value()
            .path("signSettings").path("assetBorrow").path("employeeSign").asBoolean()).isFalse();
        assertThat(repository.find("assetPortalSelfServiceSettingsV9").orElseThrow().value()
            .path("signSettings").path("assetHandover").path("employeeSign").asBoolean()).isFalse();
        assertThat(repository.find("assetLabelCustomTemplatesV1")).isPresent();
        assertThat(repository.find("assetLabelPrintSettingsV2")).isPresent();
    }

    @Test
    void neverOverwritesExistingConfiguration() {
        var existing = mapper.createArrayNode().add(mapper.createObjectNode()
            .put("id", "custom-category").put("name", "自定义分类").set("children", mapper.createArrayNode()));
        repository.saveAll(Map.of("assetCategoryTree", existing));

        assertThat(initializer.initializeMissing()).isEqualTo(6);
        assertThat(repository.find("assetCategoryTree").orElseThrow().value()).isEqualTo(existing);
        assertThat(repository.find("assetLocationTree")).isPresent();
    }
}
