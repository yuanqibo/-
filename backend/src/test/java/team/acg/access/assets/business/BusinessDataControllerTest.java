package team.acg.access.assets.business;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.jdbc.core.JdbcTemplate;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = "spring.datasource.url=jdbc:h2:mem:business-test;MODE=MySQL;DB_CLOSE_DELAY=-1")
class BusinessDataControllerTest {
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;

    @BeforeEach
    void clearBusinessData() {
        jdbc.update("DELETE FROM business_snapshot");
    }

    @Test
    void createsAndListsMigratedBusinessDataButRejectsSnapshotOverwrite() throws Exception {
        mvc.perform(put("/api/business-data/requests").contentType(MediaType.APPLICATION_JSON)
                .content("{\"items\":[{\"id\":\"REQ-1\",\"type\":\"领用\",\"applicant\":\"李雷\"}],\"expectedVersion\":0}"))
            .andExpect(status().isCreated()).andExpect(jsonPath("$.version").value(1));

        mvc.perform(put("/api/business-data/requests").contentType(MediaType.APPLICATION_JSON)
                .content("{\"items\":[{\"id\":\"REQ-2\",\"type\":\"领用\",\"applicant\":\"李雷\"}],\"expectedVersion\":1}"))
            .andExpect(status().isBadRequest());

        mvc.perform(get("/api/business-data"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.values.requests[0].id").value("REQ-1"))
            .andExpect(jsonPath("$.versions.requests").value(1));
    }

    @Test
    void rejectsStaleWritesAndUnknownTypes() throws Exception {
        mvc.perform(put("/api/business-data/stocktakes").contentType(MediaType.APPLICATION_JSON)
                .content("{\"items\":[],\"expectedVersion\":0}"))
            .andExpect(status().isCreated());
        mvc.perform(put("/api/business-data/stocktakes").contentType(MediaType.APPLICATION_JSON)
                .content("{\"items\":[],\"expectedVersion\":5}"))
            .andExpect(status().isBadRequest());
        mvc.perform(put("/api/business-data/unknown").contentType(MediaType.APPLICATION_JSON)
                .content("{\"items\":[],\"expectedVersion\":0}"))
            .andExpect(status().isBadRequest());
    }

    @Test
    void createsRequestsWithServerControlledWorkflowFields() throws Exception {
        mvc.perform(post("/api/business-data/requests").contentType(MediaType.APPLICATION_JSON)
                .content("{\"type\":\"资产领用\",\"applicant\":\"李雷\",\"asset\":\"电脑\",\"reason\":\"入职\",\"details\":{\"status\":\"已完成\",\"operator\":\"管理员\"}}"))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.item.status").value("审批中"))
            .andExpect(jsonPath("$.item.currentNode").value("直属主管"))
            .andExpect(jsonPath("$.item.operator").value("管理员"));
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
        String response = mvc.perform(post("/api/business-data/repairs").contentType(MediaType.APPLICATION_JSON)
                .content("{\"asset\":\"A-100\",\"description\":\"无法开机\",\"reporter\":\"李雷\"}"))
            .andExpect(status().isCreated()).andExpect(jsonPath("$.item.status").value("待处理"))
            .andReturn().getResponse().getContentAsString();
        String id = new com.fasterxml.jackson.databind.ObjectMapper().readTree(response).path("item").path("id").asText();
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch("/api/business-data/repairs/" + id)
                .contentType(MediaType.APPLICATION_JSON).content("{\"status\":\"维修中\",\"handler\":\"管理员\"}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.items[0].handler").value("管理员"));

        mvc.perform(post("/api/business-data/contracts").contentType(MediaType.APPLICATION_JSON)
                .content("{\"supplier\":\"供应商A\",\"name\":\"采购合同\",\"endDate\":\"2027-01-01\",\"amount\":12000}"))
            .andExpect(status().isCreated()).andExpect(jsonPath("$.item.status").value("在用"));
    }
}
