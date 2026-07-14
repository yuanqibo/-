package team.acg.access.assets.store;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
@TestPropertySource(properties = "spring.datasource.url=jdbc:h2:mem:catalog-reference-test;MODE=MySQL;DB_CLOSE_DELAY=-1")
class PortalConfigReferenceIntegrationTest {
    @Autowired MockMvc mvc;

    @Test
    void renamesReferencesTransactionallyAndRejectsReferencedDeletes() throws Exception {
        saveCategories("电脑").andExpect(status().isOk());
        saveLocations("A区").andExpect(status().isOk());
        mvc.perform(post("/api/assets").contentType(MediaType.APPLICATION_JSON).content("""
            {"item":{"id":"PC-REF","name":"引用测试资产","category":"电脑","location":"总部 / A区"}}
            """))
            .andExpect(status().isOk());

        saveCategories("办公电脑")
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.updatedAssets").value(1));
        saveLocations("B区")
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.updatedAssets").value(1));

        mvc.perform(get("/api/assets"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.items[0].category").value("办公电脑"))
            .andExpect(jsonPath("$.items[0].location").value("总部 / B区"));

        mvc.perform(put("/api/config/catalog/locations").contentType(MediaType.APPLICATION_JSON).content("""
            {"value":[{"id":"loc-hq","name":"总部","children":[]}]}
            """))
            .andExpect(status().isBadRequest());
        mvc.perform(get("/api/store"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.values.assetLocationTree[0].children[0].name").value("B区"));
    }

    private org.springframework.test.web.servlet.ResultActions saveCategories(String name) throws Exception {
        return mvc.perform(put("/api/config/catalog/categories").contentType(MediaType.APPLICATION_JSON)
            .content("{\"value\":[{\"id\":\"cat-computer\",\"name\":\"" + name + "\",\"children\":[]}]}"));
    }

    private org.springframework.test.web.servlet.ResultActions saveLocations(String childName) throws Exception {
        return mvc.perform(put("/api/config/catalog/locations").contentType(MediaType.APPLICATION_JSON)
            .content("{\"value\":[{\"id\":\"loc-hq\",\"name\":\"总部\",\"children\":[{\"id\":\"loc-area\",\"name\":\""
                + childName + "\",\"children\":[]}]}]}"));
    }
}
