package team.acg.access.assets.ecp;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:fail-closed-test;MODE=MySQL;DB_CLOSE_DELAY=-1",
    "ecp.sdk.enabled=false"
})
class BusinessApiFailClosedIntegrationTest {
    @Autowired MockMvc mvc;

    @Test
    void rejectsBusinessApisWhenEcpIsDisabledOutsideTheTestBypass() throws Exception {
        mvc.perform(get("/api/assets"))
            .andExpect(status().isServiceUnavailable())
            .andExpect(jsonPath("$.error").value("ECP server authorization is disabled"));
    }
}
