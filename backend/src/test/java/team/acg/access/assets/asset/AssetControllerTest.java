package team.acg.access.assets.asset;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.jdbc.core.JdbcTemplate;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_EACH_TEST_METHOD)
@TestPropertySource(properties = "spring.datasource.url=jdbc:h2:mem:asset-test;MODE=MySQL;DB_CLOSE_DELAY=-1")
class AssetControllerTest {
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;

    @BeforeEach
    void clearAssets() {
        jdbc.update("DELETE FROM asset_audit_log");
        jdbc.update("DELETE FROM asset_record");
    }

    @Test
    void persistsAValidatedAsset() throws Exception {
        mvc.perform(post("/api/assets").contentType(MediaType.APPLICATION_JSON).content("""
            {"item":{"id":"PC-001","name":"开发电脑","category":"电脑","price":5000}}
            """))
            .andExpect(status().isOk()).andExpect(jsonPath("$.item.status").value("空闲"));

        mvc.perform(get("/api/assets"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.items[0].id").value("PC-001"));
    }

    @Test
    void executesLifecycleCommandsWithServerControlledStatusAndHistory() throws Exception {
        mvc.perform(post("/api/assets").contentType(MediaType.APPLICATION_JSON).content("""
            {"item":{"id":"PC-CMD","name":"命令电脑","category":"电脑"}}
            """))
            .andExpect(status().isOk());

        mvc.perform(post("/api/assets/commands/receive").contentType(MediaType.APPLICATION_JSON).content("""
            {"assetIds":["PC-CMD"],"fields":{"receiver":"李雷","department":"研发部","company":"默认公司","location":"总部","date":"2026-07-10"}}
            """))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.items[0].status").value("在用"))
            .andExpect(jsonPath("$.items[0].owner").value("李雷"))
            .andExpect(jsonPath("$.items[0].lifecycle[1][1]").value("资产领用"));

        mvc.perform(post("/api/assets/commands/borrow").contentType(MediaType.APPLICATION_JSON).content("""
            {"assetIds":["PC-CMD"],"fields":{"borrower":"韩梅梅","location":"总部","date":"2026-07-10","expectedReturnDate":"2026-07-20"}}
            """))
            .andExpect(status().isBadRequest());
    }

    @Test
    void createsAssetWithoutTrustingClientStatusOrLifecycle() throws Exception {
        mvc.perform(post("/api/assets").contentType(MediaType.APPLICATION_JSON).content("""
            {"item":{"id":"PC-NEW","name":"新电脑","category":"电脑","owner":"","status":"已报废","lifecycle":[["x","伪造","伪造"]]}}
            """))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.item.status").value("空闲"))
            .andExpect(jsonPath("$.item.lifecycle[0][1]").value("资产入库"));
    }
}
