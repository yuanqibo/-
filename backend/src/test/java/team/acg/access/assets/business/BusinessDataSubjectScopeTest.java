package team.acg.access.assets.business;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import team.acg.access.assets.auth.RequestIdentityService;

import java.util.Optional;
import java.util.Set;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@TestPropertySource(properties = "spring.datasource.url=jdbc:h2:mem:business-subject-scope-test;MODE=MySQL;DB_CLOSE_DELAY=-1")
class BusinessDataSubjectScopeTest {
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @MockitoBean RequestIdentityService identityService;

    @BeforeEach
    void setUp() {
        jdbc.update("DELETE FROM business_snapshot");
        jdbc.update("DELETE FROM approval_request_record");
        insertRequest("REQ-OWNED", "李雷", "user-1");
        insertRequest("REQ-LEGACY-NAME", "李雷", "");
        insertRequest("REQ-OTHER", "韩梅梅", "user-2");
        var identity = new RequestIdentityService.Identity(
            "李雷", "lilei", "user-1", "directory-user-1", "tenant-1", "销售部", "示例公司", Set.of("dept-sales"),
            "employee", Set.of("asset:request:view"));
        when(identityService.current(any())).thenReturn(Optional.of(identity));
    }

    @Test
    void scopesRequestsOnlyByStableSubjectAndNeverByDisplayName() throws Exception {
        mvc.perform(get("/api/business-data"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.values.requests.length()").value(1))
            .andExpect(jsonPath("$.values.requests[0].id").value("REQ-OWNED"));
    }

    private void insertRequest(String id, String applicant, String subject) {
        var now = java.sql.Timestamp.from(java.time.Instant.now());
        String document = "{\"id\":\"" + id + "\",\"applicant\":\"" + applicant
            + "\",\"applicantSubject\":\"" + subject + "\"}";
        jdbc.update("INSERT INTO approval_request_record (request_id, request_type, request_status, "
                + "applicant_subject, applicant_directory_subject, approval_no, biz_no, document, version, "
                + "created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            id, "资产领用", "审批中", subject, "", "", id, document, 1L, now, now);
    }
}
