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

import java.sql.Timestamp;
import java.time.Instant;
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
        jdbc.update("INSERT INTO business_snapshot (snapshot_type, document, version, updated_at) VALUES (?, ?, ?, ?)",
            "requests", """
                [
                  {"id":"REQ-OWNED","applicant":"李雷","applicantSubject":"user-1"},
                  {"id":"REQ-LEGACY-NAME","applicant":"李雷"},
                  {"id":"REQ-OTHER","applicant":"韩梅梅","applicantSubject":"user-2"}
                ]
                """, 1L, Timestamp.from(Instant.now()));
        var identity = new RequestIdentityService.Identity(
            "李雷", "lilei", "user-1", "directory-user-1", "tenant-1", "销售部", Set.of("dept-sales"),
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
}
