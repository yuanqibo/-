package team.acg.access.assets.business;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import team.acg.access.assets.approval.ApprovalRequestRepository;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
@ActiveProfiles("test")
@TestPropertySource(properties = "spring.datasource.url=jdbc:h2:mem:database-cleanup-test;MODE=MySQL;DB_CLOSE_DELAY=-1")
class DatabaseCleanupMigrationTest {
    @Autowired DatabaseCleanupMigration migration;
    @Autowired ApprovalRequestRepository approvalRequests;
    @Autowired BusinessDataRepository businessData;
    @Autowired ObjectMapper mapper;
    @Autowired JdbcTemplate jdbc;

    @BeforeEach
    void resetState() {
        jdbc.execute("DROP TABLE IF EXISTS business_snapshot");
        jdbc.execute("DROP TABLE IF EXISTS app_store_pre_java_20260723_030516");
        jdbc.update("DELETE FROM app_store");
        jdbc.update("DELETE FROM approval_request_record");
        jdbc.update("DELETE FROM asset_stocktake_record");
        jdbc.update("DELETE FROM consumable_record");
        jdbc.update("DELETE FROM asset_repair_record");
        jdbc.update("DELETE FROM asset_contract_record");
        jdbc.update("DELETE FROM asset_disposal_record");
        jdbc.execute("""
            CREATE TABLE business_snapshot (
              snapshot_type VARCHAR(64) PRIMARY KEY,
              document LONGTEXT NOT NULL,
              version BIGINT NOT NULL,
              updated_at TIMESTAMP(3) NOT NULL
            )
            """);
        jdbc.execute("CREATE TABLE app_store_pre_java_20260723_030516 (`key` VARCHAR(191) PRIMARY KEY, `value` LONGTEXT NOT NULL, updated_at VARCHAR(64) NOT NULL)");
    }

    @Test
    void separatesLegacyBusinessDataAndRemovesRedundantStorage() throws Exception {
        insertSnapshot("requests", """
            [
              {"id":"REQ-1","type":"资产领用","status":"审批中","applicantSubject":"user-1","bizNo":"REQ-1"},
              {"id":"REQ-2","type":"资产借用","status":"已完成","applicantSubject":"user-2","bizNo":"REQ-2"}
            ]
            """);
        insertSnapshot("stocktakes", "[{\"id\":\"STK-1\",\"name\":\"年度盘点\"}]");
        insertSnapshot("disposals", "[{\"id\":\"DSP-1\",\"status\":\"待处置\"}]");
        jdbc.update("INSERT INTO app_store (store_key, store_value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
            "assetPortalAssets", "[{\"id\":\"OLD-ASSET\"}]");
        jdbc.update("INSERT INTO app_store_pre_java_20260723_030516 (`key`, `value`, updated_at) VALUES (?, ?, ?)",
            "assetPortalAssets", "[]", "2026-07-23T03:05:16Z");

        DatabaseCleanupMigration.CleanupResult result = migration.clean();

        assertThat(result.migratedApprovalRequests()).isEqualTo(2);
        assertThat(result.migratedBusinessRecords()).isEqualTo(2);
        assertThat(result.removedLegacyAssets()).isEqualTo(1);
        assertThat(approvalRequests.findAll()).extracting(value -> value.path("id").asText())
            .containsExactlyInAnyOrder("REQ-1", "REQ-2");
        assertThat(businessData.find("stocktakes").orElseThrow().document().path(0).path("id").asText())
            .isEqualTo("STK-1");
        assertThat(businessData.find("disposals").orElseThrow().document().path(0).path("id").asText())
            .isEqualTo("DSP-1");
        assertThat(tableExists("business_snapshot")).isFalse();
        assertThat(tableExists("app_store_pre_java_20260723_030516")).isFalse();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM app_store WHERE store_key = 'assetPortalAssets'", Integer.class))
            .isZero();
    }

    @Test
    void cleanupIsIdempotent() {
        migration.clean();

        DatabaseCleanupMigration.CleanupResult result = migration.clean();

        assertThat(result.migratedBusinessRecords()).isZero();
        assertThat(result.migratedApprovalRequests()).isZero();
        assertThat(result.removedLegacyAssets()).isZero();
    }

    private void insertSnapshot(String type, String document) throws Exception {
        jdbc.update("INSERT INTO business_snapshot (snapshot_type, document, version, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)",
            type, mapper.readTree(document).toString(), 1L);
    }

    private boolean tableExists(String table) {
        Integer count = jdbc.queryForObject(
            "SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE LOWER(TABLE_NAME) = LOWER(?)", Integer.class, table);
        return count != null && count > 0;
    }
}
