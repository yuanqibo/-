package team.acg.access.assets.approval;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import team.acg.access.assets.asset.AssetPartyResolver;
import team.acg.access.assets.asset.AssetService;

import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

class ApprovedAssetRequestExecutorTest {
    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void reusesTheAuthenticatedApplicantForReceiveWithoutAnotherDirectoryLookup() {
        AssetService assets = mock(AssetService.class);
        AssetPartyResolver parties = mock(AssetPartyResolver.class);
        ApprovedAssetRequestExecutor executor = new ApprovedAssetRequestExecutor(assets, parties, mapper);
        ObjectNode request = baseRequest("资产领用", "A-1");
        request.put("receiveLocation", "一楼");
        request.put("receiveDate", "2026-07-21");

        executor.execute(request, ApprovedAssetRequestExecutor.Operator.ecp());

        ArgumentCaptor<ObjectNode> fields = ArgumentCaptor.forClass(ObjectNode.class);
        verify(assets).execute(eq("receive"), eq(List.of("A-1")), fields.capture());
        verifyNoInteractions(parties);
        assertThat(fields.getValue().path("receiver").asText()).isEqualTo("李雷");
        assertThat(fields.getValue().path("receiverSubject").asText()).isEqualTo("user-1");
        assertThat(fields.getValue().path("department").asText()).isEqualTo("销售部");
    }

    @Test
    void stillValidatesAnEmployeeHandoverTargetAgainstTheDirectory() {
        AssetService assets = mock(AssetService.class);
        AssetPartyResolver parties = mock(AssetPartyResolver.class);
        ApprovedAssetRequestExecutor executor = new ApprovedAssetRequestExecutor(assets, parties, mapper);
        ObjectNode request = baseRequest("资产交接", "A-1");
        request.put("receiverSubject", "user-2");
        request.put("handoverLocation", "二楼");
        request.put("handoverDate", "2026-07-21");
        request.put("handoverType", "员工交接");

        executor.execute(request, ApprovedAssetRequestExecutor.Operator.ecp());

        verify(assets).requireOwnedForApprovedRequest(List.of("A-1"), "user-1", Set.of("在用", "借用中"));
        verify(parties).normalizeCommand(eq("handover"), any(ObjectNode.class));
        verify(assets).execute(eq("handover"), eq(List.of("A-1")), any(ObjectNode.class));
    }

    private ObjectNode baseRequest(String type, String assetId) {
        ObjectNode request = mapper.createObjectNode();
        request.put("type", type);
        request.put("applicant", "李雷");
        request.put("applicantDirectorySubject", "user-1");
        request.put("department", "销售部");
        request.put("reason", "测试");
        request.putArray("assetIds").add(assetId);
        return request;
    }
}
