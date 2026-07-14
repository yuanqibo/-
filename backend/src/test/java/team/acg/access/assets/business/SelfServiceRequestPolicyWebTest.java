package team.acg.access.assets.business;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import team.acg.access.assets.auth.RequestIdentityService;
import team.acg.access.assets.store.AppStoreRepository;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@TestPropertySource(properties = "spring.datasource.url=jdbc:h2:mem:self-service-policy-test;MODE=MySQL;DB_CLOSE_DELAY=-1")
class SelfServiceRequestPolicyWebTest {
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper mapper;
    @Autowired AppStoreRepository storeRepository;
    @MockitoBean RequestIdentityService identityService;

    @BeforeEach
    void resetData() {
        jdbc.update("DELETE FROM business_snapshot");
        jdbc.update("DELETE FROM asset_record");
        useIdentity(employee());
        saveSettings(true, false, List.of("笔记本电脑"));
    }

    @Test
    void rejectsDisabledEmployeeRequest() throws Exception {
        saveSettings(false, false, List.of("笔记本电脑"));

        mvc.perform(post("/api/business-data/requests").contentType(MediaType.APPLICATION_JSON)
                .content(request("资产领用", "办公需要", "A-1")))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error").value("Employee self-service request is disabled: 资产领用"));
    }

    @Test
    void requiresRemarkWhenConfigured() throws Exception {
        saveSettings(true, true, List.of("笔记本电脑"));

        mvc.perform(post("/api/business-data/requests").contentType(MediaType.APPLICATION_JSON)
                .content(request("资产领用", "", "A-1")))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("Request reason is required"));
    }

    @Test
    void rejectsAssetOutsideConfiguredCategories() throws Exception {
        insertAsset("A-1", "笔记本电脑", "空闲", "", "未分配");
        saveSettings(true, false, List.of("显示器"));

        mvc.perform(post("/api/business-data/requests").contentType(MediaType.APPLICATION_JSON)
                .content(request("资产领用", "办公需要", "A-1")))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("Requested asset category is not enabled for self-service: 笔记本电脑"));
    }

    @Test
    void rejectsUnknownEmployeeRequestType() throws Exception {
        mvc.perform(post("/api/business-data/requests").contentType(MediaType.APPLICATION_JSON)
                .content(request("管理员补录", "补录历史数据", "A-1")))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error").value("Unsupported employee self-service request type: 管理员补录"));
    }

    @Test
    void rejectsEmptyOrInaccessibleAssetSelection() throws Exception {
        mvc.perform(post("/api/business-data/requests").contentType(MediaType.APPLICATION_JSON)
                .content("{\"type\":\"资产借用\",\"applicant\":\"李雷\",\"asset\":\"电脑\",\"reason\":\"临时使用\",\"details\":{\"assetIds\":[]}}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("At least one asset id is required"));

        insertAsset("A-2", "笔记本电脑", "在用", "user-2", "韩梅梅");
        mvc.perform(post("/api/business-data/requests").contentType(MediaType.APPLICATION_JSON)
                .content(request("资产借用", "临时使用", "A-2")))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error").value("One or more requested assets are not accessible"));
    }

    @Test
    void rejectsOwnedAssetsThatAreNotAvailableForReceiveOrBorrow() throws Exception {
        insertAsset("A-OWNED", "笔记本电脑", "在用", "user-1", "李雷");

        mvc.perform(post("/api/business-data/requests").contentType(MediaType.APPLICATION_JSON)
                .content(request("资产领用", "重复领用", "A-OWNED")))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("Requested assets must be available for self-service"));
        mvc.perform(post("/api/business-data/requests").contentType(MediaType.APPLICATION_JSON)
                .content(request("资产借用", "重复借用", "A-OWNED")))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("Requested assets must be available for self-service"));
    }

    @Test
    void requiresOwnershipAndTheCorrectStateForReturnAndHandoverRequests() throws Exception {
        insertAsset("A-OTHER", "笔记本电脑", "在用", "user-2", "韩梅梅");
        mvc.perform(post("/api/business-data/requests").contentType(MediaType.APPLICATION_JSON)
                .content(request("资产退还", "离职退还", "A-OTHER")))
            .andExpect(status().isForbidden());

        insertAsset("A-AVAILABLE", "笔记本电脑", "空闲", "user-1", "李雷");
        mvc.perform(post("/api/business-data/requests").contentType(MediaType.APPLICATION_JSON)
                .content(request("资产交接", "转交同事", "A-AVAILABLE")))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("Requested assets are not eligible for this self-service action"));

        insertAsset("A-BORROWED", "笔记本电脑", "借用中", "user-1", "李雷");
        mvc.perform(post("/api/business-data/requests").contentType(MediaType.APPLICATION_JSON)
                .content(request("资产归还", "使用完毕", "A-BORROWED")))
            .andExpect(status().isCreated());
    }

    @Test
    void managerBypassesEmployeeSelfServicePolicy() throws Exception {
        useIdentity(manager());
        saveSettings(false, true, List.of());

        mvc.perform(post("/api/business-data/requests").contentType(MediaType.APPLICATION_JSON)
                .content("{\"type\":\"管理员补录\",\"applicant\":\"伪造名称\",\"asset\":\"历史资产\"}"))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.item.applicant").value("管理员"))
            .andExpect(jsonPath("$.item.type").value("管理员补录"));
    }

    private void saveSettings(boolean enabled, boolean remarkRequired, List<String> categories) {
        ObjectNode settings = mapper.createObjectNode();
        settings.set("receiveAsset", policy(enabled, remarkRequired, categories));
        settings.set("borrowAsset", policy(enabled, remarkRequired, categories));
        settings.set("giveBackAsset", policy(enabled, remarkRequired, List.of()));
        settings.set("returnAsset", policy(enabled, remarkRequired, List.of()));
        settings.set("handoverAsset", policy(enabled, remarkRequired, List.of()));
        storeRepository.saveAll(Map.of(SelfServiceRequestPolicy.SETTINGS_KEY, settings));
    }

    private ObjectNode policy(boolean enabled, boolean remarkRequired, List<String> categories) {
        ObjectNode policy = mapper.createObjectNode();
        policy.put("enabled", enabled);
        policy.put("remarkRequired", remarkRequired);
        policy.set("categories", mapper.valueToTree(categories));
        return policy;
    }

    private void insertAsset(String id, String category, String status, String ownerSubject, String owner) throws Exception {
        ObjectNode asset = mapper.createObjectNode();
        asset.put("id", id);
        asset.put("name", id + " 资产");
        asset.put("category", category);
        asset.put("status", status);
        asset.put("ownerSubject", ownerSubject);
        asset.put("owner", owner);
        jdbc.update("INSERT INTO asset_record (asset_id, status, document, version, updated_at) VALUES (?, ?, ?, ?, ?)",
            id, status, mapper.writeValueAsString(asset), 1L, Timestamp.from(Instant.now()));
    }

    private String request(String type, String reason, String assetId) throws Exception {
        ObjectNode request = mapper.createObjectNode();
        request.put("type", type);
        request.put("applicant", "李雷");
        request.put("asset", "电脑");
        request.put("reason", reason);
        ObjectNode details = request.putObject("details");
        details.set("assetIds", mapper.valueToTree(List.of(assetId)));
        return mapper.writeValueAsString(request);
    }

    private void useIdentity(RequestIdentityService.Identity identity) {
        when(identityService.current(any())).thenReturn(Optional.of(identity));
        when(identityService.trustedName(any(), any())).thenReturn(identity.name());
    }

    private RequestIdentityService.Identity employee() {
        return new RequestIdentityService.Identity(
            "李雷", "lilei", "account-1", "user-1", "tenant-1", "销售部", Set.of("dept-sales"), "employee",
            Set.of("asset:item:view", "asset:request:create"));
    }

    private RequestIdentityService.Identity manager() {
        return new RequestIdentityService.Identity(
            "管理员", "admin", "account-admin", "user-admin", "tenant-1", "信息部", Set.of("dept-it"), "admin",
            Set.of("asset:item:view", "asset:request:create", "asset:request:review"));
    }
}
