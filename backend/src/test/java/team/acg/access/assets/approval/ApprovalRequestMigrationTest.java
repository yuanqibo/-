package team.acg.access.assets.approval;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import team.acg.access.assets.business.BusinessDataRepository;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
@ActiveProfiles("test")
@TestPropertySource(properties = "spring.datasource.url=jdbc:h2:mem:approval-migration-test;MODE=MySQL;DB_CLOSE_DELAY=-1")
class ApprovalRequestMigrationTest {
    @Autowired ApprovalRequestMigration migration;
    @Autowired ApprovalRequestRepository approvalRequests;
    @Autowired BusinessDataRepository businessData;
    @Autowired ObjectMapper mapper;
    @Autowired JdbcTemplate jdbc;

    @BeforeEach
    void resetState() {
        jdbc.update("DELETE FROM approval_request_record");
        jdbc.update("DELETE FROM business_snapshot");
    }

    @Test
    void migratesRequestsAndRemovesOnlyTheObsoleteSnapshot() throws Exception {
        businessData.create("stocktakes", mapper.readTree("[{\"id\":\"STK-1\"}]"));
        businessData.create("requests", mapper.readTree("""
            [
              {"id":"REQ-1","type":"资产领用","status":"审批中","applicantSubject":"user-1","bizNo":"REQ-1"},
              {"id":"REQ-2","type":"资产借用","status":"已完成","applicantSubject":"user-2","bizNo":"REQ-2"}
            ]
            """));

        assertThat(migration.migrateLegacyRequests()).isEqualTo(2);

        assertThat(approvalRequests.findAll()).extracting(value -> value.path("id").asText())
            .containsExactlyInAnyOrder("REQ-1", "REQ-2");
        assertThat(businessData.find("requests")).isEmpty();
        assertThat(businessData.find("stocktakes")).isPresent();
        assertThat(migration.migrateLegacyRequests()).isZero();
    }
}
