package team.acg.access.assets.approval;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.idanchuang.ecp.sdk.client.EcpClient;
import com.idanchuang.ecp.sdk.client.model.approval.JavaSdkApprovalDecisionRequest;
import com.idanchuang.ecp.sdk.client.model.approval.JavaSdkApprovalInstanceStartResponse;
import com.idanchuang.ecp.sdk.client.model.approval.JavaSdkApprovalStartByTemplateRequest;
import com.idanchuang.ecp.sdk.client.operation.ApprovalOperations;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.ObjectProvider;
import team.acg.access.assets.auth.RequestIdentityService;

import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ApprovalIntegrationServiceTest {
    @Test
    void startsByTemplateWithTheApplicationScopedContract() {
        Fixture fixture = fixture();
        JavaSdkApprovalInstanceStartResponse response = new JavaSdkApprovalInstanceStartResponse();
        response.setApprovalNo("APPROVAL-100");
        response.setBizNo("REQ-100");
        response.setTemplateCode("ASSET_REQUEST");
        response.setStatus("PENDING");
        response.setCurrentNodeName("直属主管");
        when(fixture.operations.startByTemplate(
            org.mockito.ArgumentMatchers.any(JavaSdkApprovalStartByTemplateRequest.class))).thenReturn(response);
        ObjectNode item = fixture.mapper.createObjectNode();
        item.put("id", "REQ-100");
        item.put("type", "资产领用");
        item.put("reason", "入职");
        var identity = new RequestIdentityService.Identity("李雷", "lilei", "member-1", "union-1", "tenant-1",
            "研发部", "示例公司", Set.of("dept-1"), "employee", Set.of("asset:request:create"));

        var started = fixture.service.start(item, identity);

        assertThat(started.approvalNo()).isEqualTo("APPROVAL-100");
        ArgumentCaptor<JavaSdkApprovalStartByTemplateRequest> request =
            ArgumentCaptor.forClass(JavaSdkApprovalStartByTemplateRequest.class);
        verify(fixture.operations).startByTemplate(request.capture());
        assertThat(request.getValue().getTemplateCode()).isEqualTo("ASSET_REQUEST");
        assertThat(request.getValue().getBizNo()).isEqualTo("REQ-100");
        assertThat(request.getValue().getInitiatorUnionId()).isEqualTo("union-1");
        assertThat(request.getValue().getCallbackUrl())
            .isEqualTo("https://assets.example.com/api/ecp/approval/callback");
        assertThat(request.getValue().getFormData().tables()).containsKey("MAIN");
    }

    @Test
    void decidesByApprovalNumber() {
        Fixture fixture = fixture();

        fixture.service.decide("APPROVAL-100", "approve", "manager-1", "同意");

        ArgumentCaptor<JavaSdkApprovalDecisionRequest> request =
            ArgumentCaptor.forClass(JavaSdkApprovalDecisionRequest.class);
        verify(fixture.operations).approveInstanceByApprovalNo(
            org.mockito.ArgumentMatchers.eq("APPROVAL-100"), request.capture());
        assertThat(request.getValue().getOperatorUnionId()).isEqualTo("manager-1");
        assertThat(request.getValue().getComment()).isEqualTo("同意");
    }

    @SuppressWarnings("unchecked")
    private Fixture fixture() {
        ObjectProvider<EcpClient> provider = mock(ObjectProvider.class);
        EcpClient client = mock(EcpClient.class);
        ApprovalOperations operations = mock(ApprovalOperations.class);
        when(provider.getIfAvailable()).thenReturn(client);
        when(client.approval()).thenReturn(operations);
        ObjectMapper mapper = new ObjectMapper();
        ApprovalIntegrationProperties properties = new ApprovalIntegrationProperties(
            true, "ASSET_REQUEST", "MAIN", "", "https://assets.example.com");
        return new Fixture(new ApprovalIntegrationService(provider, properties, mapper), operations, mapper);
    }

    private record Fixture(ApprovalIntegrationService service, ApprovalOperations operations, ObjectMapper mapper) {}
}
