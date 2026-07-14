package team.acg.access.assets.systemconfig;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import java.nio.charset.StandardCharsets;
import java.util.Base64;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:system-config-test;MODE=MySQL;DB_CLOSE_DELAY=-1",
    "asset-portal.system-config.encryption-key=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="
})
class SystemConfigControllerTest {
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper mapper;

    @BeforeEach
    void clearData() {
        jdbc.update("DELETE FROM system_integration");
        jdbc.update("DELETE FROM system_form_definition");
    }

    @Test
    void persistsEncryptedIntegrationsAndUsesOptimisticVersions() throws Exception {
        String createdBody = mvc.perform(post("/api/system/integrations")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"code":"feishu-prod","name":"飞书生产连接","provider":"feishu",
                     "baseUrl":"https://open.feishu.cn","enabled":true,
                     "config":{"tenant":"asset-team"},"secret":"do-not-store-in-plaintext"}
                    """))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.version").value(1))
            .andExpect(jsonPath("$.secretConfigured").value(true))
            .andExpect(jsonPath("$.secret").doesNotExist())
            .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
        String id = mapper.readTree(createdBody).path("id").asText();

        String ciphertext = jdbc.queryForObject(
            "SELECT secret_ciphertext FROM system_integration WHERE integration_id = ?", String.class, id);
        assertThat(ciphertext).isNotBlank().doesNotContain("do-not-store-in-plaintext");
        assertThat(Base64.getDecoder().decode(ciphertext)[0]).isEqualTo((byte) 1);

        mvc.perform(get("/api/system/integrations"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.items[0].code").value("feishu-prod"))
            .andExpect(jsonPath("$.items[0].secretConfigured").value(true));

        String update = """
            {"code":"feishu-prod","name":"飞书连接（更新）","provider":"feishu",
             "baseUrl":"https://open.feishu.cn","enabled":false,
             "config":{"tenant":"asset-team-v2"},"expectedVersion":1}
            """;
        mvc.perform(put("/api/system/integrations/" + id).contentType(MediaType.APPLICATION_JSON).content(update))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.version").value(2))
            .andExpect(jsonPath("$.enabled").value(false))
            .andExpect(jsonPath("$.secretConfigured").value(true));
        mvc.perform(put("/api/system/integrations/" + id).contentType(MediaType.APPLICATION_JSON).content(update))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.error").value("Integration version conflict"));

        mvc.perform(delete("/api/system/integrations/" + id))
            .andExpect(status().isMethodNotAllowed());
    }

    @Test
    void rejectsUnsafeIntegrationValuesAndEmbeddedSecrets() throws Exception {
        mvc.perform(post("/api/system/integrations").contentType(MediaType.APPLICATION_JSON).content("""
            {"code":"unsafe","name":"不安全连接","provider":"oa","baseUrl":"file:///etc/passwd","config":{}}
            """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("Integration base URL scheme must be http or https"));

        mvc.perform(post("/api/system/integrations").contentType(MediaType.APPLICATION_JSON).content("""
            {"code":"unsafe","name":"不安全连接","provider":"oa","baseUrl":"https://oa.example.com",
             "config":{"nested":{"accessToken":"plaintext"}}}
            """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("Sensitive integration values must use the dedicated secret field"));

        String oversized = "x".repeat(SystemConfigValidator.MAX_INTEGRATION_CONFIG_BYTES + 1);
        JsonNode request = mapper.createObjectNode()
            .put("code", "too-large")
            .put("name", "过大连接")
            .put("provider", "oa")
            .put("baseUrl", "https://oa.example.com")
            .set("config", mapper.createObjectNode().put("value", oversized));
        mvc.perform(post("/api/system/integrations").contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsBytes(request)))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("Integration config exceeds 32768 bytes"));
    }

    @Test
    void persistsUpdatesAndDeletesFormDefinitionsWithExpectedVersion() throws Exception {
        String createdBody = mvc.perform(post("/api/system/forms").contentType(MediaType.APPLICATION_JSON).content("""
            {"code":"asset-receive","name":"资产领用表单","description":"员工自助领用",
             "schema":{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object",
                       "properties":{"reason":{"type":"string"}},"required":["reason"]}}
            """))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.version").value(1))
            .andExpect(jsonPath("$.schema.properties.reason.type").value("string"))
            .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
        String id = mapper.readTree(createdBody).path("id").asText();

        String update = """
            {"code":"asset-receive","name":"资产领用表单 V2","description":"新增用途字段","enabled":true,
             "schema":{"type":"object","properties":{"reason":{"type":"string"},"purpose":{"type":"string"}}},
             "expectedVersion":1}
            """;
        mvc.perform(put("/api/system/forms/" + id).contentType(MediaType.APPLICATION_JSON).content(update))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.version").value(2))
            .andExpect(jsonPath("$.name").value("资产领用表单 V2"));
        mvc.perform(delete("/api/system/forms/" + id).param("expectedVersion", "1"))
            .andExpect(status().isConflict());
        mvc.perform(delete("/api/system/forms/" + id).param("expectedVersion", "2"))
            .andExpect(status().isNoContent());
        mvc.perform(get("/api/system/forms/" + id))
            .andExpect(status().isNotFound());
    }

    @Test
    void rejectsRemoteSchemaReferencesAndOversizedSchemas() throws Exception {
        mvc.perform(post("/api/system/forms").contentType(MediaType.APPLICATION_JSON).content("""
            {"code":"remote-ref","name":"远程引用","schema":{"$ref":"https://metadata.example/schema.json"}}
            """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("Form schema only supports local $ref values"));

        String oversized = "x".repeat(SystemConfigValidator.MAX_FORM_SCHEMA_BYTES + 1);
        JsonNode request = mapper.createObjectNode()
            .put("code", "large-form")
            .put("name", "过大表单")
            .set("schema", mapper.createObjectNode().put("title", oversized));
        mvc.perform(post("/api/system/forms").contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsBytes(request)))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("Form schema exceeds 65536 bytes"));
    }
}
