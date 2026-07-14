package team.acg.access.assets.web;

import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.List;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.forwardedUrl;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class SpaControllerTest {
    private final MockMvc mvc = MockMvcBuilders.standaloneSetup(new SpaController()).build();

    @Test
    void forwardsEveryManagedFrontendEntryToTheSpa() throws Exception {
        for (String path : List.of(
            "/", "/login", "/login/callback/feishu", "/no-permission", "/workspace",
            "/assets", "/assets/inbound", "/assets/receive-return", "/assets/borrow-return",
            "/assets/stocktake", "/assets/consumables", "/assets/repairs", "/assets/contracts",
            "/assets/settings", "/assets/settings/locations", "/assets/settings/categories",
            "/assets/settings/code-rules", "/assets/settings/label-templates", "/requests",
            "/system", "/system/employees", "/system/departments", "/system/self-service",
            "/system/integrations", "/system/forms"
        )) {
            mvc.perform(get(path))
                .andExpect(status().isOk())
                .andExpect(forwardedUrl("/index.html"));
        }
    }

    @Test
    void doesNotTurnUnknownApiPathsIntoTheSpa() throws Exception {
        mvc.perform(get("/api/not-a-real-endpoint"))
            .andExpect(status().isNotFound());
    }
}
