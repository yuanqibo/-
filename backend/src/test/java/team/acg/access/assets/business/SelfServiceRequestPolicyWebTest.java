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
import team.acg.access.assets.asset.AssetOperationRepository;
import team.acg.access.assets.store.AppStoreRepository;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
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
    @Autowired AssetOperationRepository operationRepository;
    @MockitoBean RequestIdentityService identityService;

    @BeforeEach
    void resetData() {
        jdbc.update("DELETE FROM business_snapshot");
        jdbc.update("DELETE FROM approval_request_record");
        jdbc.update("DELETE FROM asset_operation_record");
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

        insertAsset("A-2", "笔记本电脑", "领用", "user-2", "韩梅梅");
        mvc.perform(post("/api/business-data/requests").contentType(MediaType.APPLICATION_JSON)
                .content(request("资产借用", "临时使用", "A-2")))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error").value("One or more requested assets are not accessible"));
    }

    @Test
    void rejectsOwnedAssetsThatAreNotAvailableForReceiveOrBorrow() throws Exception {
        insertAsset("A-OWNED", "笔记本电脑", "领用", "user-1", "李雷");

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
    void selfServiceReceiveOnlyAcceptsTheIdleStatus() throws Exception {
        insertAsset("A-LISTED", "笔记本电脑", "闲置", "", "未分配");

        mvc.perform(post("/api/business-data/requests").contentType(MediaType.APPLICATION_JSON)
                .content(request("资产领用", "办公需要", "A-LISTED")))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("Requested assets must be available for self-service"));
    }

    @Test
    void selfServiceBorrowOnlyAcceptsTheIdleStatus() throws Exception {
        insertAsset("A-BORROW-LISTED", "笔记本电脑", "闲置", "", "未分配");

        mvc.perform(post("/api/business-data/requests").contentType(MediaType.APPLICATION_JSON)
                .content(request("资产借用", "临时使用", "A-BORROW-LISTED")))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("Requested assets must be available for self-service"));
    }

    @Test
    void rejectsBorrowReturnDateBeforeTheBorrowDate() throws Exception {
        insertAsset("A-BORROW-DATE", "笔记本电脑", "空闲", "", "未分配");
        ObjectNode invalid = (ObjectNode) mapper.readTree(request("资产借用", "临时使用", "A-BORROW-DATE"));
        ((ObjectNode) invalid.path("details")).put("expectedReturnDate", "2026-07-21");

        mvc.perform(post("/api/business-data/requests").contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(invalid)))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("Expected return date cannot be before borrow date"));
    }

    @Test
    void keepsSelfServiceBorrowPendingUntilAnAdministratorApprovesIt() throws Exception {
        insertAsset("A-BORROW-PENDING", "笔记本电脑", "空闲", "", "未分配");
        saveSettings(true, false, List.of("笔记本电脑"), true, true, true);

        String response = mvc.perform(post("/api/business-data/requests").contentType(MediaType.APPLICATION_JSON)
                .content(request("资产借用", "临时项目使用", "A-BORROW-PENDING")))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.item.selfServiceRequest").value(true))
            .andExpect(jsonPath("$.item.status").value("待审批"))
            .andExpect(jsonPath("$.item.currentNode").value("管理员审批"))
            .andExpect(jsonPath("$.item.borrowLocation").value("杭州公司 / 19幢1楼"))
            .andExpect(jsonPath("$.item.borrowDate").value("2026-07-22"))
            .andExpect(jsonPath("$.item.expectedReturnDate").value("2026-08-22"))
            .andReturn().getResponse().getContentAsString();

        org.assertj.core.api.Assertions.assertThat(asset("A-BORROW-PENDING").path("status").asText())
            .isEqualTo("空闲");
        String requestId = mapper.readTree(response).path("item").path("id").asText();
        useIdentity(manager());
        mvc.perform(post("/api/business-data/requests/" + requestId + "/decision")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"decision\":\"approve\",\"operator\":\"管理员\",\"reason\":\"同意借用\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.items[0].status").value("已同意"));

        ObjectNode borrowed = asset("A-BORROW-PENDING");
        org.assertj.core.api.Assertions.assertThat(borrowed.path("status").asText()).isEqualTo("借用中");
        org.assertj.core.api.Assertions.assertThat(borrowed.path("borrowDate").asText()).isEqualTo("2026-07-22");
        org.assertj.core.api.Assertions.assertThat(borrowed.path("custodian").asText()).isEqualTo("管理员");
        org.assertj.core.api.Assertions.assertThat(borrowed.path("owner").asText()).isEqualTo("李雷");
        org.assertj.core.api.Assertions.assertThat(borrowed.path("ownerSubject").asText()).isEqualTo("user-1");
        org.assertj.core.api.Assertions.assertThat(borrowed.path("expectedReturnDate").asText()).isEqualTo("2026-08-22");
    }

    @Test
    void immediatelyApprovesAndExecutesSelfServiceBorrowWhenApprovalIsDisabled() throws Exception {
        insertAsset("A-BORROW-NOW", "笔记本电脑", "空闲", "", "未分配");
        saveSettings(true, false, List.of("笔记本电脑"), true, false, true);

        mvc.perform(post("/api/business-data/requests").contentType(MediaType.APPLICATION_JSON)
                .content(request("资产借用", "临时项目使用", "A-BORROW-NOW")))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.item.status").value("已同意"))
            .andExpect(jsonPath("$.item.system").value("系统自动审批"))
            .andExpect(jsonPath("$.item.currentNode").value("已归档"))
            .andExpect(jsonPath("$.item.approvalStatus").value("APPROVED"));

        ObjectNode borrowed = asset("A-BORROW-NOW");
        org.assertj.core.api.Assertions.assertThat(borrowed.path("status").asText()).isEqualTo("借用中");
        org.assertj.core.api.Assertions.assertThat(borrowed.path("owner").asText()).isEqualTo("李雷");
        mvc.perform(get("/api/assets"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.items[?(@.id == 'A-BORROW-NOW')].status").value("借用中"));
    }

    @Test
    void keepsSelfServiceReceivePendingUntilAnAdministratorApprovesIt() throws Exception {
        insertAsset("A-RECEIVE-PENDING", "笔记本电脑", "空闲", "", "未分配");
        saveSettings(true, false, List.of("笔记本电脑"), true, true);

        String response = mvc.perform(post("/api/business-data/requests").contentType(MediaType.APPLICATION_JSON)
                .content(request("资产领用", "办公需要", "A-RECEIVE-PENDING")))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.item.selfServiceRequest").value(true))
            .andExpect(jsonPath("$.item.status").value("待审批"))
            .andExpect(jsonPath("$.item.currentNode").value("管理员审批"))
            .andExpect(jsonPath("$.item.receiveType").value("个人领用"))
            .andReturn().getResponse().getContentAsString();

        org.assertj.core.api.Assertions.assertThat(asset("A-RECEIVE-PENDING").path("status").asText())
            .isEqualTo("空闲");
        mvc.perform(get("/api/business-data"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.values.requests[0].status").value("待审批"));

        String requestId = mapper.readTree(response).path("item").path("id").asText();
        useIdentity(manager());
        mvc.perform(post("/api/business-data/requests/" + requestId + "/decision")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"decision\":\"approve\",\"operator\":\"管理员\",\"reason\":\"同意领用\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.items[0].status").value("已同意"));

        ObjectNode received = asset("A-RECEIVE-PENDING");
        org.assertj.core.api.Assertions.assertThat(received.path("status").asText()).isEqualTo("领用");
        org.assertj.core.api.Assertions.assertThat(received.path("receiveDate").asText()).isEqualTo("2026-07-22");
        org.assertj.core.api.Assertions.assertThat(received.path("custodian").asText()).isEqualTo("管理员");
        org.assertj.core.api.Assertions.assertThat(received.path("owner").asText()).isEqualTo("李雷");
        org.assertj.core.api.Assertions.assertThat(received.path("ownerSubject").asText()).isEqualTo("user-1");
    }

    @Test
    void immediatelyApprovesAndExecutesSelfServiceReceiveWhenApprovalIsDisabled() throws Exception {
        insertAsset("A-RECEIVE-NOW", "笔记本电脑", "空闲", "", "未分配");
        saveSettings(true, false, List.of("笔记本电脑"), false, true);

        mvc.perform(post("/api/business-data/requests").contentType(MediaType.APPLICATION_JSON)
                .content(request("资产领用", "办公需要", "A-RECEIVE-NOW")))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.item.status").value("已同意"))
            .andExpect(jsonPath("$.item.system").value("系统自动审批"))
            .andExpect(jsonPath("$.item.currentNode").value("已归档"))
            .andExpect(jsonPath("$.item.approvalStatus").value("APPROVED"));

        ObjectNode received = asset("A-RECEIVE-NOW");
        org.assertj.core.api.Assertions.assertThat(received.path("status").asText()).isEqualTo("领用");
        org.assertj.core.api.Assertions.assertThat(received.path("owner").asText()).isEqualTo("李雷");
        org.assertj.core.api.Assertions.assertThat(received.path("ownerSubject").asText()).isEqualTo("user-1");
        mvc.perform(get("/api/assets"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.items[?(@.id == 'A-RECEIVE-NOW')].owner").value("李雷"));
    }

    @Test
    void requiresOwnershipAndTheCorrectStateForReturnAndHandoverRequests() throws Exception {
        insertAsset("A-OTHER", "笔记本电脑", "领用", "user-2", "韩梅梅");
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
    void keepsSelfServiceHandoverPendingWhenManagerApprovalIsRequired() throws Exception {
        insertAsset("A-HANDOVER-PENDING", "笔记本电脑", "领用", "user-1", "李雷");
        saveSettings(true, false, List.of("笔记本电脑"), true);

        String response = mvc.perform(post("/api/business-data/requests").contentType(MediaType.APPLICATION_JSON)
                .content(handoverRequest("A-HANDOVER-PENDING")))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.item.status").value("待审批"))
            .andExpect(jsonPath("$.item.currentNode").value("管理员审批"))
            .andExpect(jsonPath("$.item.receiverName").value("韩梅梅"))
            .andReturn().getResponse().getContentAsString();

        org.assertj.core.api.Assertions.assertThat(asset("A-HANDOVER-PENDING").path("ownerSubject").asText())
            .isEqualTo("user-1");

        String requestId = mapper.readTree(response).path("item").path("id").asText();
        useIdentity(manager());
        mvc.perform(post("/api/business-data/requests/" + requestId + "/decision")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"decision\":\"approve\",\"operator\":\"管理员\",\"reason\":\"同意交接\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.items[0].status").value("已同意"));
        org.assertj.core.api.Assertions.assertThat(asset("A-HANDOVER-PENDING").path("ownerSubject").asText())
            .isEqualTo("user-2");
    }

    @Test
    void immediatelyApprovesAndExecutesSelfServiceHandoverWhenApprovalIsDisabled() throws Exception {
        insertAsset("A-HANDOVER-NOW", "笔记本电脑", "领用", "user-1", "李雷");
        saveSettings(true, false, List.of("笔记本电脑"), false);

        mvc.perform(post("/api/business-data/requests").contentType(MediaType.APPLICATION_JSON)
                .content(handoverRequest("A-HANDOVER-NOW")))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.item.status").value("已同意"))
            .andExpect(jsonPath("$.item.currentNode").value("已归档"))
            .andExpect(jsonPath("$.item.approvalStatus").value("APPROVED"));

        ObjectNode transferred = asset("A-HANDOVER-NOW");
        org.assertj.core.api.Assertions.assertThat(transferred.path("owner").asText()).isEqualTo("韩梅梅");
        org.assertj.core.api.Assertions.assertThat(transferred.path("ownerSubject").asText()).isEqualTo("user-2");

        useIdentity(receiver());
        mvc.perform(get("/api/assets"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.items[0].id").value("A-HANDOVER-NOW"))
            .andExpect(jsonPath("$.items[0].owner").value("韩梅梅"));
    }

    @Test
    void keepsSelfServiceReturnPendingUntilAnAdministratorApprovesIt() throws Exception {
        insertAsset("A-RETURN", "笔记本电脑", "领用", "user-1", "李雷");

        String response = mvc.perform(post("/api/business-data/requests").contentType(MediaType.APPLICATION_JSON)
                .content(returnRequest("A-RETURN")))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.item.status").value("待审批"))
            .andExpect(jsonPath("$.item.currentNode").value("管理员审批"))
            .andExpect(jsonPath("$.item.assetCount").value(1))
            .andExpect(jsonPath("$.item.company").value("示例公司"))
            .andExpect(jsonPath("$.item.department").value("销售部"))
            .andReturn().getResponse().getContentAsString();

        mvc.perform(get("/api/business-data"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.values.requests[0].status").value("待审批"));
        org.assertj.core.api.Assertions.assertThat(asset("A-RETURN").path("ownerSubject").asText())
            .isEqualTo("user-1");

        String requestId = mapper.readTree(response).path("item").path("id").asText();
        useIdentity(manager());
        mvc.perform(post("/api/business-data/requests/" + requestId + "/decision")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"decision\":\"approve\",\"operator\":\"管理员\",\"reason\":\"同意退还\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.items[0].status").value("已同意"));

        ObjectNode returned = asset("A-RETURN");
        org.assertj.core.api.Assertions.assertThat(returned.path("status").asText()).isEqualTo("空闲");
        org.assertj.core.api.Assertions.assertThat(returned.path("owner").asText()).isEqualTo("未分配");
        org.assertj.core.api.Assertions.assertThat(returned.path("ownerSubject").asText()).isEmpty();
    }

    @Test
    void keepsSelfServiceGiveBackPendingUntilAnAdministratorApprovesIt() throws Exception {
        insertAsset("A-GIVE-BACK", "笔记本电脑", "借用中", "user-1", "李雷");
        insertBorrowOperation("A-GIVE-BACK", "user-1");

        String response = mvc.perform(post("/api/business-data/requests").contentType(MediaType.APPLICATION_JSON)
                .content(request("资产归还", "使用完毕", "A-GIVE-BACK")))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.item.selfServiceRequest").value(true))
            .andExpect(jsonPath("$.item.status").value("待审批"))
            .andExpect(jsonPath("$.item.currentNode").value("管理员审批"))
            .andExpect(jsonPath("$.item.returnLocation").value("杭州公司 / 19幢1楼"))
            .andExpect(jsonPath("$.item.returnDate").value("2026-07-22"))
            .andReturn().getResponse().getContentAsString();

        ObjectNode pending = asset("A-GIVE-BACK");
        org.assertj.core.api.Assertions.assertThat(pending.path("status").asText()).isEqualTo("借用中");
        org.assertj.core.api.Assertions.assertThat(pending.path("ownerSubject").asText()).isEqualTo("user-1");

        String requestId = mapper.readTree(response).path("item").path("id").asText();
        useIdentity(manager());
        mvc.perform(post("/api/business-data/requests/" + requestId + "/decision")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"decision\":\"approve\",\"operator\":\"管理员\",\"reason\":\"确认归还\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.items[0].status").value("已同意"));

        ObjectNode returned = asset("A-GIVE-BACK");
        org.assertj.core.api.Assertions.assertThat(returned.path("status").asText()).isEqualTo("空闲");
        org.assertj.core.api.Assertions.assertThat(returned.path("owner").asText()).isEqualTo("未分配");
        org.assertj.core.api.Assertions.assertThat(returned.path("ownerSubject").asText()).isEmpty();
        org.assertj.core.api.Assertions.assertThat(returned.path("returnDate").asText()).isEqualTo("2026-07-22");
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
        saveSettings(enabled, remarkRequired, categories, true);
    }

    private void saveSettings(boolean enabled, boolean remarkRequired, List<String> categories,
                              boolean handoverApprovalRequired) {
        saveSettings(enabled, remarkRequired, categories, true, handoverApprovalRequired);
    }

    private void saveSettings(boolean enabled, boolean remarkRequired, List<String> categories,
                              boolean receiveApprovalRequired, boolean handoverApprovalRequired) {
        saveSettings(enabled, remarkRequired, categories, receiveApprovalRequired, true,
            handoverApprovalRequired);
    }

    private void saveSettings(boolean enabled, boolean remarkRequired, List<String> categories,
                              boolean receiveApprovalRequired, boolean borrowApprovalRequired,
                              boolean handoverApprovalRequired) {
        ObjectNode settings = mapper.createObjectNode();
        ObjectNode receive = policy(enabled, remarkRequired, categories);
        receive.put("approvalRequired", receiveApprovalRequired);
        settings.set("receiveAsset", receive);
        ObjectNode borrow = policy(enabled, remarkRequired, categories);
        borrow.put("approvalRequired", borrowApprovalRequired);
        settings.set("borrowAsset", borrow);
        settings.set("giveBackAsset", policy(enabled, remarkRequired, List.of()));
        settings.set("returnAsset", policy(enabled, remarkRequired, List.of()));
        ObjectNode handover = policy(enabled, remarkRequired, List.of());
        handover.put("approvalRequired", handoverApprovalRequired);
        settings.set("handoverAsset", handover);
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

    private void insertBorrowOperation(String assetId, String ownerSubject) {
        ObjectNode operation = mapper.createObjectNode();
        operation.put("id", "JY-" + assetId);
        operation.put("assetId", assetId);
        operation.put("type", "BORROW");
        operation.put("status", "待归还");
        operation.put("partySubject", ownerSubject);
        operation.put("previousPartySubject", "");
        operation.put("returnOrderId", "GH-" + assetId);
        operation.put("date", "2026-07-10");
        operationRepository.create(operation);
    }

    private String request(String type, String reason, String assetId) throws Exception {
        ObjectNode request = mapper.createObjectNode();
        request.put("type", type);
        request.put("applicant", "李雷");
        request.put("asset", "电脑");
        request.put("reason", reason);
        ObjectNode details = request.putObject("details");
        details.set("assetIds", mapper.valueToTree(List.of(assetId)));
        details.put("assetCount", 1);
        if ("资产领用".equals(type)) {
            details.put("receiveType", "个人领用");
            details.put("receiveLocation", "杭州公司 / 19幢1楼");
            details.put("receiveDate", "2026-07-22");
        } else if ("资产借用".equals(type)) {
            details.put("borrowLocation", "杭州公司 / 19幢1楼");
            details.put("borrowDate", "2026-07-22");
            details.put("expectedReturnDate", "2026-08-22");
        } else if ("资产归还".equals(type)) {
            details.put("returnLocation", "杭州公司 / 19幢1楼");
            details.put("returnDate", "2026-07-22");
        }
        return mapper.writeValueAsString(request);
    }

    private String handoverRequest(String assetId) throws Exception {
        ObjectNode request = mapper.createObjectNode();
        request.put("type", "资产交接");
        request.put("applicant", "李雷");
        request.put("asset", assetId + " 资产");
        request.put("reason", "岗位交接");
        ObjectNode details = request.putObject("details");
        details.set("assetIds", mapper.valueToTree(List.of(assetId)));
        details.put("assetCount", 1);
        details.put("receiverSubject", "user-2");
        details.put("receiverName", "韩梅梅");
        details.put("receiverCompany", "示例公司");
        details.put("receiverDepartment", "研发部");
        details.put("handoverLocation", "杭州公司 / 19幢1楼");
        details.put("handoverDate", "2026-07-22");
        details.put("handoverType", "员工交接");
        return mapper.writeValueAsString(request);
    }

    private String returnRequest(String assetId) throws Exception {
        ObjectNode request = mapper.createObjectNode();
        request.put("type", "资产退还");
        request.put("applicant", "李雷");
        request.put("asset", assetId + " 资产");
        request.put("reason", "设备不再使用");
        ObjectNode details = request.putObject("details");
        details.set("assetIds", mapper.valueToTree(List.of(assetId)));
        details.put("assetCount", 1);
        details.put("returnLocation", "杭州公司 / 19幢1楼");
        details.put("returnDate", "2026-07-22");
        return mapper.writeValueAsString(request);
    }

    private ObjectNode asset(String id) throws Exception {
        String document = jdbc.queryForObject(
            "SELECT document FROM asset_record WHERE asset_id = ?", String.class, id);
        return (ObjectNode) mapper.readTree(document);
    }

    private void useIdentity(RequestIdentityService.Identity identity) {
        when(identityService.current(any())).thenReturn(Optional.of(identity));
        when(identityService.trustedName(any(), any())).thenReturn(identity.name());
    }

    private RequestIdentityService.Identity employee() {
        return new RequestIdentityService.Identity(
            "李雷", "lilei", "account-1", "user-1", "tenant-1", "销售部", "示例公司", Set.of("dept-sales"), "employee",
            Set.of("asset:item:view", "asset:request:view", "asset:request:create"));
    }

    private RequestIdentityService.Identity manager() {
        return new RequestIdentityService.Identity(
            "管理员", "admin", "account-admin", "user-admin", "tenant-1", "信息部", "示例公司", Set.of("dept-it"), "admin",
            Set.of("asset:item:view", "asset:request:create", "asset:request:review"));
    }

    private RequestIdentityService.Identity receiver() {
        return new RequestIdentityService.Identity(
            "韩梅梅", "hanmeimei", "account-2", "user-2", "tenant-1", "研发部", "示例公司", Set.of("dept-rd"), "employee",
            Set.of("asset:item:view", "asset:request:view", "asset:request:create"));
    }
}
