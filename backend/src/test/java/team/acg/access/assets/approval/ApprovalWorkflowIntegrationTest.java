package team.acg.access.assets.approval;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@SpringBootTest
@ActiveProfiles("test")
@TestPropertySource(properties = "spring.datasource.url=jdbc:h2:mem:approval-workflow-test;MODE=MySQL;DB_CLOSE_DELAY=-1")
class ApprovalWorkflowIntegrationTest {
    @Autowired ApprovalRequestStateService state;
    @Autowired ApprovalCallbackRepository callbacks;
    @Autowired ApprovalRequestRepository approvalRequests;
    @Autowired ObjectMapper mapper;
    @Autowired JdbcTemplate jdbc;
    @MockitoBean ApprovedAssetRequestExecutor executor;

    @BeforeEach
    void resetState() {
        reset(executor);
        org.springframework.test.jdbc.JdbcTestUtils.deleteFromTables(
            jdbc, "approval_callback_event", "approval_request_record", "business_snapshot");
    }

    @Test
    void appliesApprovedStateAndExecutesTheAssetCommandOnlyOnce() throws Exception {
        createRequest("REQ-1", "APPROVAL-1", "资产领用");
        state.markExternalDecisionSubmitted("REQ-1", "approve",
            new ApprovedAssetRequestExecutor.Operator("王管理", "", "manager-1", "manager-1"), "同意");
        when(executor.supports("资产领用")).thenReturn(true);
        var detail = mapper.readTree("""
            {"approvalNo":"APPROVAL-1","bizNo":"REQ-1","instanceId":101,
             "process":{"status":"APPROVED","currentNode":{"name":"结束"}}}
            """);

        state.applyRemoteDetail(detail);
        state.applyRemoteDetail(detail);

        JsonNodeView item = request("REQ-1");
        assertThat(item.text("status")).isEqualTo("已完成");
        assertThat(item.text("approvalStatus")).isEqualTo("APPROVED");
        assertThat(item.number("instanceId")).isEqualTo(101L);
        verify(executor, times(1)).execute(
            org.mockito.ArgumentMatchers.any(ObjectNode.class),
            org.mockito.ArgumentMatchers.eq(new ApprovedAssetRequestExecutor.Operator(
                "王管理", "", "manager-1", "manager-1")));
    }

    @Test
    void mapsRejectedStateWithoutExecutingAnAssetCommand() throws Exception {
        createRequest("REQ-2", "APPROVAL-2", "资产借用");
        var detail = mapper.readTree("""
            {"approvalNo":"APPROVAL-2","bizNo":"REQ-2","process":{"status":"REJECTED"}}
            """);

        state.applyRemoteDetail(detail);

        assertThat(request("REQ-2").text("status")).isEqualTo("已拒绝");
        verify(executor, never()).execute(
            org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any());
    }

    @Test
    void storesAndClaimsEachCallbackEventOnlyOnce() throws Exception {
        var payload = mapper.readTree("""
            {"eventId":"event-1","eventType":"APPROVAL_STATUS_CHANGED","ownerAppCode":"WLY5YG",
             "approvalNo":"APPROVAL-1","bizNo":"REQ-1"}
            """);

        assertThat(callbacks.accept("event-1", "APPROVAL-1", "REQ-1", "APPROVAL_STATUS_CHANGED", payload)).isTrue();
        assertThat(callbacks.accept("event-1", "APPROVAL-1", "REQ-1", "APPROVAL_STATUS_CHANGED", payload)).isFalse();
        var claimed = callbacks.claimBatch(10);
        assertThat(claimed).hasSize(1);
        callbacks.processed(claimed.get(0).eventId());
        assertThat(callbacks.claimBatch(10)).isEmpty();
    }

    private void createRequest(String id, String approvalNo, String type) {
        ObjectNode item = mapper.createObjectNode();
        item.put("id", id);
        item.put("bizNo", id);
        item.put("approvalNo", approvalNo);
        item.put("type", type);
        item.put("status", "审批中");
        approvalRequests.create(item);
    }

    private JsonNodeView request(String id) {
        return new JsonNodeView(approvalRequests.find(id).orElseThrow());
    }

    private record JsonNodeView(com.fasterxml.jackson.databind.JsonNode value) {
        String text(String field) { return value.path(field).asText(); }
        long number(String field) { return value.path(field).asLong(); }
    }
}
