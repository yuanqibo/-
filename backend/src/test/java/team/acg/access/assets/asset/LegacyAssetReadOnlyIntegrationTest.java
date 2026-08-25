package team.acg.access.assets.asset;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

import java.sql.Timestamp;
import java.time.Instant;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:legacy-read-only-test;MODE=MySQL;DB_CLOSE_DELAY=-1",
    "asset-portal.legacy-asset-sync.enabled=true",
    "asset-portal.legacy-asset-sync.read-only=true"
})
class LegacyAssetReadOnlyIntegrationTest {
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;

    @Test
    void blocksNewAssetWritesWhileLegacyAmsIsAuthoritative() throws Exception {
        mvc.perform(post("/api/assets")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"item":{"id":"PC-001","name":"开发电脑","category":"电脑","location":"总部"}}
                    """))
            .andExpect(status().isLocked());
    }

    @Test
    void blocksLifecycleCommandsWhileLegacyAmsIsAuthoritative() throws Exception {
        mvc.perform(post("/api/assets/commands/receive")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"assetIds":["PC-001"],"fields":{"receiver":"李雷"}}
                    """))
            .andExpect(status().isLocked());
    }

    @Test
    void exposesOperationalStatusAndAllowsDeadLetterRetry() throws Exception {
        mvc.perform(get("/api/system/legacy-asset-sync/status"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.sourceOfTruth").value("legacy-ams"))
            .andExpect(jsonPath("$.readOnly").value(true))
            .andExpect(jsonPath("$.schedule").value("0 0/30 * * * *"))
            .andExpect(jsonPath("$.timeZone").value("Asia/Shanghai"));

        String id = "dlq-001";
        Instant now = Instant.now();
        jdbc.update("INSERT INTO legacy_asset_sync_dead_letter (dead_letter_id, event_key, source_asset_id, error_message, retry_count, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            id, "7:1:hash", "7", "temporary failure", 0, "PENDING", Timestamp.from(now), Timestamp.from(now));

        mvc.perform(get("/api/system/legacy-asset-sync/dead-letters"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.items[0].id").value(id));
        mvc.perform(post("/api/system/legacy-asset-sync/dead-letters/{id}/retry", id))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.retried").value(true));
        org.assertj.core.api.Assertions.assertThat(jdbc.queryForObject(
            "SELECT retry_count FROM legacy_asset_sync_dead_letter WHERE dead_letter_id = ?", Integer.class, id))
            .isEqualTo(1);
    }
}
