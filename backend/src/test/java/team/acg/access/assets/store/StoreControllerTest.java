package team.acg.access.assets.store;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = "spring.datasource.url=jdbc:h2:mem:store-test;MODE=MySQL;DB_CLOSE_DELAY=-1")
class StoreControllerTest {
    @Autowired MockMvc mvc;

    @Test
    void persistsDeclaredPortalDocuments() throws Exception {
        mvc.perform(post("/api/store").contentType(MediaType.APPLICATION_JSON)
                .content("{\"key\":\"assetLabelCustomTemplatesV1\",\"value\":[]}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.ok").value(true));

        mvc.perform(get("/api/store/item").param("key", "assetLabelCustomTemplatesV1"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.found").value(true))
            .andExpect(jsonPath("$.value").isArray());
    }

    @Test
    void rejectsTheAssetKeyThatMigratedToTheDomainApi() throws Exception {
        mvc.perform(post("/api/store").contentType(MediaType.APPLICATION_JSON)
                .content("{\"key\":\"assetPortalAssets\",\"value\":[]}"))
            .andExpect(status().isBadRequest());
    }

    @Test
    void rejectsUnsafeKeys() throws Exception {
        mvc.perform(post("/api/store").contentType(MediaType.APPLICATION_JSON)
                .content("{\"key\":\"../unsafe\",\"value\":true}"))
            .andExpect(status().isBadRequest());
    }

    @Test
    void rejectsUnknownOrMalformedPortalDocuments() throws Exception {
        mvc.perform(post("/api/store").contentType(MediaType.APPLICATION_JSON)
                .content("{\"key\":\"arbitraryFeatureFlag\",\"value\":true}"))
            .andExpect(status().isBadRequest());

        mvc.perform(post("/api/store").contentType(MediaType.APPLICATION_JSON)
                .content("{\"key\":\"assetLocationTree\",\"value\":{}}"))
            .andExpect(status().isBadRequest());
    }

    @Test
    void rejectsPrivilegeEscalationAndDuplicateTreeNodes() throws Exception {
        mvc.perform(post("/api/store").contentType(MediaType.APPLICATION_JSON)
                .content("{\"key\":\"assetPortalRegisteredUsers\",\"value\":[{\"account\":\"user\",\"name\":\"用户\",\"roleCode\":\"super_admin\"}]}"))
            .andExpect(status().isBadRequest());

        mvc.perform(put("/api/config/catalog/locations").contentType(MediaType.APPLICATION_JSON)
                .content("{\"value\":[{\"id\":\"same\",\"name\":\"A\"},{\"id\":\"same\",\"name\":\"B\"}]}"))
            .andExpect(status().isBadRequest());
    }

    @Test
    void writesCatalogThroughDedicatedEndpointButRejectsLocalIdentityWrites() throws Exception {
        mvc.perform(post("/api/store").contentType(MediaType.APPLICATION_JSON)
                .content("{\"key\":\"assetCategoryTree\",\"value\":[{\"id\":\"cat-1\",\"name\":\"电脑\",\"children\":[]}]}"))
            .andExpect(status().isBadRequest());

        mvc.perform(put("/api/config/catalog/categories").contentType(MediaType.APPLICATION_JSON)
                .content("{\"value\":[{\"id\":\"cat-1\",\"name\":\"电脑\",\"children\":[]}]}"))
            .andExpect(status().isOk());
        mvc.perform(put("/api/config/security/users").contentType(MediaType.APPLICATION_JSON)
                .content("{\"value\":[{\"account\":\"user\",\"name\":\"用户\",\"roleCode\":\"employee\"}]}"))
            .andExpect(status().isNotFound());
    }
}
