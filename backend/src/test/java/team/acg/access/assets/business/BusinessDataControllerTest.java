package team.acg.access.assets.business;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import team.acg.access.assets.approval.ApprovalIntegrationService;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@TestPropertySource(properties = "spring.datasource.url=jdbc:h2:mem:business-test;MODE=MySQL;DB_CLOSE_DELAY=-1")
class BusinessDataControllerTest {
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @MockitoBean ApprovalIntegrationService approvalIntegration;

    @BeforeEach
    void clearBusinessData() {
        org.mockito.Mockito.reset(approvalIntegration);
        jdbc.update("DELETE FROM business_snapshot");
        jdbc.update("DELETE FROM asset_operation_record");
        jdbc.update("DELETE FROM asset_record");
    }

    @Test
    void createsAndListsBusinessDataThroughDomainCommands() throws Exception {
        mvc.perform(post("/api/business-data/requests").contentType(MediaType.APPLICATION_JSON)
                .content("{\"type\":\"领用\",\"applicant\":\"李雷\",\"asset\":\"电脑\"}"))
            .andExpect(status().isCreated());
        mvc.perform(get("/api/business-data"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.values.requests[0].applicant").value("李雷"))
            .andExpect(jsonPath("$.versions.requests").value(1));
    }

    @Test
    void rejectsLegacySnapshotWrites() throws Exception {
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put("/api/business-data/requests")
                .contentType(MediaType.APPLICATION_JSON).content("{\"items\":[],\"expectedVersion\":0}"))
            .andExpect(status().isMethodNotAllowed());
    }

    @Test
    void createsRequestsWithServerControlledWorkflowFields() throws Exception {
        mvc.perform(post("/api/business-data/requests").contentType(MediaType.APPLICATION_JSON)
                .content("{\"type\":\"资产领用\",\"applicant\":\"李雷\",\"asset\":\"电脑\",\"reason\":\"入职\",\"details\":{\"status\":\"已完成\",\"operator\":\"管理员\"}}"))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.item.status").value("审批中"))
            .andExpect(jsonPath("$.item.currentNode").value("直属主管"))
            .andExpect(jsonPath("$.item.operator").doesNotExist());
    }

    @Test
    void rejectsARequestLocationOutsideTheServerCatalogBeforeStartingApproval() throws Exception {
        mvc.perform(post("/api/business-data/requests").contentType(MediaType.APPLICATION_JSON)
                .content("{\"type\":\"资产领用\",\"applicant\":\"李雷\",\"asset\":\"电脑\",\"details\":{\"receiveLocation\":\"不存在的位置\"}}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("Request location is not present in the server catalog: 不存在的位置"));
        org.mockito.Mockito.verify(approvalIntegration, org.mockito.Mockito.never())
            .start(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any());
    }

    @Test
    void recordsRequestDecisionsAndRejectsRepeatedFinalization() throws Exception {
        String response = mvc.perform(post("/api/business-data/requests").contentType(MediaType.APPLICATION_JSON)
                .content("{\"type\":\"资产领用\",\"applicant\":\"李雷\",\"asset\":\"电脑\",\"reason\":\"入职\"}"))
            .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        String id = new com.fasterxml.jackson.databind.ObjectMapper().readTree(response).path("item").path("id").asText();

        mvc.perform(post("/api/business-data/requests/" + id + "/decision").contentType(MediaType.APPLICATION_JSON)
                .content("{\"decision\":\"reject\",\"operator\":\"管理员\",\"reason\":\"资料不全\"}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.items[0].status").value("已拒绝"))
            .andExpect(jsonPath("$.items[0].decisionOperator").value("管理员"));
        mvc.perform(post("/api/business-data/requests/" + id + "/decision").contentType(MediaType.APPLICATION_JSON)
                .content("{\"decision\":\"approve\",\"operator\":\"管理员\"}"))
            .andExpect(status().isBadRequest());
    }

    @Test
    void keepsLegacyRequestsDecidableAfterExternalApprovalIsEnabled() throws Exception {
        String response = mvc.perform(post("/api/business-data/requests").contentType(MediaType.APPLICATION_JSON)
                .content("{\"type\":\"管理员补录\",\"applicant\":\"管理员\",\"asset\":\"历史资产\"}"))
            .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        String id = new ObjectMapper().readTree(response).path("item").path("id").asText();
        org.mockito.Mockito.when(approvalIntegration.enabled()).thenReturn(true);

        mvc.perform(post("/api/business-data/requests/" + id + "/decision").contentType(MediaType.APPLICATION_JSON)
                .content("{\"decision\":\"reject\",\"operator\":\"管理员\",\"reason\":\"历史流程关闭\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.items[0].status").value("已拒绝"));
        org.mockito.Mockito.verify(approvalIntegration, org.mockito.Mockito.never())
            .decide(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyString(),
                org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyString());
    }

    @Test
    void controlsStocktakeProgressAndRejectsInvalidCounts() throws Exception {
        String response = mvc.perform(post("/api/business-data/stocktakes").contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"季度盘点\",\"scope\":\"总部\",\"owner\":\"管理员\",\"total\":10,\"date\":\"2026-07-10\"}"))
            .andExpect(status().isCreated()).andExpect(jsonPath("$.item.progress").value("未开始"))
            .andReturn().getResponse().getContentAsString();
        String id = new com.fasterxml.jackson.databind.ObjectMapper().readTree(response).path("item").path("id").asText();

        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch("/api/business-data/stocktakes/" + id)
                .contentType(MediaType.APPLICATION_JSON).content("{\"checked\":6,\"diff\":1}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.items[0].progress").value("盘点中"));
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch("/api/business-data/stocktakes/" + id)
                .contentType(MediaType.APPLICATION_JSON).content("{\"checked\":11,\"diff\":1}"))
            .andExpect(status().isBadRequest());
    }

    @Test
    void preventsNegativeConsumableStock() throws Exception {
        String response = mvc.perform(post("/api/business-data/consumables").contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"复印纸\",\"model\":\"A4\",\"quantity\":5,\"minimum\":2,\"warehouse\":\"一号仓\"}"))
            .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        String id = new com.fasterxml.jackson.databind.ObjectMapper().readTree(response).path("item").path("id").asText();

        mvc.perform(post("/api/business-data/consumables/" + id + "/adjust").contentType(MediaType.APPLICATION_JSON)
                .content("{\"quantity\":-6,\"reason\":\"领用\"}"))
            .andExpect(status().isBadRequest());
        mvc.perform(post("/api/business-data/consumables/" + id + "/adjust").contentType(MediaType.APPLICATION_JSON)
                .content("{\"quantity\":-3,\"reason\":\"领用\"}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.items[0].stock").value(2));
    }

    @Test
    void persistsRepairWorkflowAndContracts() throws Exception {
        insertRepairAsset("A-100");
        String response = mvc.perform(post("/api/business-data/repairs").contentType(MediaType.APPLICATION_JSON)
                .content("{\"asset\":\"A-100\",\"description\":\"无法开机\",\"reporter\":\"李雷\"}"))
            .andExpect(status().isCreated()).andExpect(jsonPath("$.item.status").value("维修中"))
            .andReturn().getResponse().getContentAsString();
        String id = new com.fasterxml.jackson.databind.ObjectMapper().readTree(response).path("item").path("id").asText();
        assertThat(assetStatus("A-100")).isEqualTo("维修中");
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch("/api/business-data/repairs/" + id)
                .contentType(MediaType.APPLICATION_JSON).content("{\"status\":\"已完成\",\"handler\":\"管理员\"}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.items[0].handler").value("管理员"));
        assertThat(assetStatus("A-100")).isEqualTo("空闲");

        mvc.perform(post("/api/business-data/contracts").contentType(MediaType.APPLICATION_JSON)
                .content("{\"supplier\":\"供应商A\",\"name\":\"采购合同\",\"endDate\":\"2027-01-01\",\"amount\":12000}"))
            .andExpect(status().isCreated()).andExpect(jsonPath("$.item.status").value("在用"));
    }

    @Test
    void createsEveryBusinessRecordWithAPrefixedUuid() throws Exception {
        ObjectMapper mapper = new ObjectMapper();
        insertRepairAsset("A-UUID");
        JsonNode request = response(post("/api/business-data/requests"),
            "{\"type\":\"管理员补录\",\"applicant\":\"管理员\",\"asset\":\"历史资产\"}", mapper);
        JsonNode stocktake = response(post("/api/business-data/stocktakes"),
            "{\"name\":\"UUID盘点\",\"scope\":\"总部\",\"owner\":\"管理员\",\"total\":1}", mapper);
        JsonNode consumable = response(post("/api/business-data/consumables"),
            "{\"name\":\"UUID耗材\",\"model\":\"A4\",\"quantity\":1,\"minimum\":0,\"warehouse\":\"总部\"}", mapper);
        JsonNode repair = response(post("/api/business-data/repairs"),
            "{\"asset\":\"A-UUID\",\"description\":\"UUID维修\",\"reporter\":\"管理员\"}", mapper);
        JsonNode contract = response(post("/api/business-data/contracts"),
            "{\"supplier\":\"供应商\",\"name\":\"UUID合同\",\"endDate\":\"2027-01-01\",\"amount\":1}", mapper);

        assertPrefixedUuid(request.path("item").path("id").asText(), "REQ");
        assertPrefixedUuid(stocktake.path("item").path("id").asText(), "STK");
        assertPrefixedUuid(consumable.path("item").path("id").asText(), "CON");
        assertPrefixedUuid(repair.path("item").path("id").asText(), "RPR");
        assertPrefixedUuid(contract.path("item").path("id").asText(), "CTR");
    }

    private JsonNode response(org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder request,
                              String body, ObjectMapper mapper) throws Exception {
        String response = mvc.perform(request.contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        return mapper.readTree(response);
    }

    private void assertPrefixedUuid(String value, String prefix) {
        assertThat(value).matches(prefix
            + "-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}");
    }

    private void insertRepairAsset(String id) throws Exception {
        ObjectMapper mapper = new ObjectMapper();
        com.fasterxml.jackson.databind.node.ObjectNode asset = mapper.createObjectNode();
        asset.put("id", id);
        asset.put("name", "维修测试资产");
        asset.put("category", "笔记本电脑");
        asset.put("type", "笔记本电脑");
        asset.put("location", "杭州公司 / 19幢1楼");
        asset.put("owner", "未分配");
        asset.put("ownerSubject", "");
        asset.put("status", "空闲");
        asset.put("price", 0);
        asset.put("rent", 0);
        asset.set("lifecycle", mapper.createArrayNode());
        jdbc.update("INSERT INTO asset_record (asset_id, status, document, version, updated_at) VALUES (?, ?, ?, ?, ?)",
            id, "空闲", asset.toString(), 1L, java.sql.Timestamp.from(java.time.Instant.now()));
    }

    private String assetStatus(String id) throws Exception {
        String document = jdbc.queryForObject("SELECT document FROM asset_record WHERE asset_id = ?", String.class, id);
        return new ObjectMapper().readTree(document).path("status").asText();
    }
}
