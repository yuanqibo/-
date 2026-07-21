package team.acg.access.assets.approval;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.idanchuang.ecp.sdk.client.EcpClient;
import com.idanchuang.ecp.sdk.client.model.approval.JavaSdkApprovalDecisionRequest;
import com.idanchuang.ecp.sdk.client.model.approval.JavaSdkApprovalFormData;
import com.idanchuang.ecp.sdk.client.model.approval.JavaSdkApprovalInstanceCancelRequest;
import com.idanchuang.ecp.sdk.client.model.approval.JavaSdkApprovalInstanceStartResponse;
import com.idanchuang.ecp.sdk.client.model.approval.JavaSdkApprovalStartByTemplateRequest;
import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;
import team.acg.access.assets.auth.RequestIdentityService;

import java.util.LinkedHashMap;
import java.util.Map;

@Service
public class ApprovalIntegrationService {
    private final ObjectProvider<EcpClient> clients;
    private final ApprovalIntegrationProperties properties;
    private final ObjectMapper mapper;

    public ApprovalIntegrationService(ObjectProvider<EcpClient> clients,
                                      ApprovalIntegrationProperties properties,
                                      ObjectMapper mapper) {
        this.clients = clients;
        this.properties = properties;
        this.mapper = mapper;
    }

    public boolean enabled() {
        return properties.enabled();
    }

    @PostConstruct
    void validateConfiguration() {
        if (!enabled()) return;
        properties.templateCode();
        properties.mainTableCode();
        properties.callbackUrl();
        if (clients.getIfAvailable() == null) {
            throw new IllegalStateException("ECP client is unavailable for approval integration");
        }
    }

    public StartResult start(ObjectNode requestItem, RequestIdentityService.Identity initiator) {
        if (!enabled()) throw new IllegalStateException("Approval integration is disabled");
        String bizNo = required(requestItem.path("id").asText(), "Approval business number is required");
        String initiatorUnionId = required(initiator.directorySubject(), "Approval initiator unionId is required");
        Map<String, Object> fields = mapper.convertValue(requestItem, new TypeReference<LinkedHashMap<String, Object>>() {});
        JavaSdkApprovalFormData formData = JavaSdkApprovalFormData.builder()
            .mainTable(properties.mainTableCode(), fields)
            .build();
        JavaSdkApprovalStartByTemplateRequest request = JavaSdkApprovalStartByTemplateRequest.builder()
            .templateCode(properties.templateCode())
            .bizNo(bizNo)
            .callbackUrl(properties.callbackUrl())
            .detailUrl(properties.detailUrl(bizNo))
            .initiatorUnionId(initiatorUnionId)
            .initiatorName(initiator.name())
            .formData(formData)
            .build();
        if (initiator.departmentIds().size() == 1) {
            request.setInitiatorDepartmentUnionId(initiator.departmentIds().iterator().next());
            request.setInitiatorDepartmentName(initiator.department());
        }
        JavaSdkApprovalInstanceStartResponse response = client().approval().startByTemplate(request);
        if (response == null) throw new IllegalStateException("ECP approval start returned no response");
        return new StartResult(
            required(response.getApprovalNo(), "ECP approval start returned no approvalNo"),
            text(response.getBizNo()).isEmpty() ? bizNo : text(response.getBizNo()),
            text(response.getTemplateCode()).isEmpty() ? properties.templateCode() : text(response.getTemplateCode()),
            text(response.getStatus()), text(response.getCurrentNodeKey()), text(response.getCurrentNodeName()),
            text(response.getCreatedAt()));
    }

    public void decide(String approvalNo, String decision, String operatorUnionId, String comment) {
        JavaSdkApprovalDecisionRequest request = JavaSdkApprovalDecisionRequest.builder()
            .operatorUnionId(required(operatorUnionId, "Approval operator unionId is required"))
            .comment(text(comment))
            .build();
        switch (decision) {
            case "approve" -> client().approval().approveInstanceByApprovalNo(requiredApprovalNo(approvalNo), request);
            case "reject" -> client().approval().rejectInstanceByApprovalNo(requiredApprovalNo(approvalNo), request);
            case "cancel" -> cancel(approvalNo, comment);
            default -> throw new IllegalArgumentException("Unsupported request decision");
        }
    }

    public JsonNode detail(String approvalNo) {
        return client().approval().getInstanceByApprovalNo(requiredApprovalNo(approvalNo));
    }

    private void cancel(String approvalNo, String comment) {
        JsonNode detail = detail(approvalNo);
        long instanceId = detail.path("instanceId").asLong(0);
        if (instanceId <= 0) throw new IllegalStateException("ECP approval detail returned no instanceId");
        JavaSdkApprovalInstanceCancelRequest request = new JavaSdkApprovalInstanceCancelRequest();
        request.setComment(text(comment));
        client().approval().cancelInstanceSimple(instanceId, request);
    }

    private EcpClient client() {
        if (!enabled()) throw new IllegalStateException("Approval integration is disabled");
        EcpClient client = clients.getIfAvailable();
        if (client == null) throw new IllegalStateException("ECP client is unavailable for approval integration");
        return client;
    }

    private String requiredApprovalNo(String value) {
        return required(value, "Request has no ECP approvalNo");
    }

    private static String required(String value, String message) {
        String normalized = text(value);
        if (normalized.isEmpty()) throw new IllegalArgumentException(message);
        return normalized;
    }

    private static String text(String value) {
        return value == null ? "" : value.trim();
    }

    public record StartResult(String approvalNo, String bizNo, String templateCode, String status,
                              String currentNodeKey, String currentNodeName, String createdAt) {}
}
