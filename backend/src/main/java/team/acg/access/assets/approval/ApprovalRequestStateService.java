package team.acg.access.assets.approval;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Set;

@Service
public class ApprovalRequestStateService {
    private static final Set<String> OPEN_STATUSES = Set.of("审批中", "待审批", "待执行");
    private static final Set<String> TERMINAL_STATUSES = Set.of("已完成", "已同意", "已拒绝", "已驳回", "已取消");
    private final ApprovalRequestRepository repository;
    private final ApprovedAssetRequestExecutor executor;

    public ApprovalRequestStateService(ApprovalRequestRepository repository, ApprovedAssetRequestExecutor executor) {
        this.repository = repository;
        this.executor = executor;
    }

    @Transactional
    public JsonNode decideLocally(String requestId, String decision, ApprovedAssetRequestExecutor.Operator operator,
                                  String reason) {
        ApprovalRequestRepository.RequestRecord record = lockedRequest(requestId);
        ObjectNode target = record.document().deepCopy();
        requireOpen(target);
        if ("approve".equals(decision)) {
            if (executor.supports(target.path("type").asText())) {
                executor.execute(target, operator);
                target.put("status", approvedStatus(target));
            } else {
                target.put("status", "待执行");
            }
        } else if ("reject".equals(decision)) {
            target.put("status", rejectedStatus(target));
        } else if ("cancel".equals(decision)) {
            target.put("status", "已取消");
        } else {
            throw new IllegalArgumentException("Unsupported request decision");
        }
        target.put("currentNode", "待执行".equals(target.path("status").asText()) ? "普通管理员执行" : "已归档");
        recordDecision(target, operator, reason);
        return save(record, target);
    }

    @Transactional
    public JsonNode markExternalDecisionSubmitted(String requestId, String decision,
                                                  ApprovedAssetRequestExecutor.Operator operator, String reason) {
        ApprovalRequestRepository.RequestRecord record = lockedRequest(requestId);
        ObjectNode target = record.document().deepCopy();
        requireOpen(target);
        target.put("decisionSubmitted", decision);
        target.put("decisionSubmittedAt", Instant.now().toString());
        target.put("currentNode", "等待审批平台同步");
        recordDecision(target, operator, reason);
        return save(record, target);
    }

    @Transactional
    public JsonNode applyRemoteDetail(JsonNode rawDetail) {
        JsonNode detail = unwrap(rawDetail);
        String approvalNo = text(detail.path("approvalNo").asText());
        String bizNo = text(detail.path("bizNo").asText());
        if (approvalNo.isEmpty() && bizNo.isEmpty()) {
            throw new IllegalArgumentException("ECP approval detail has no approvalNo or bizNo");
        }
        String remoteStatus = remoteStatus(detail);
        if (remoteStatus.isEmpty()) throw new IllegalArgumentException("ECP approval detail has no process status");

        ApprovalRequestRepository.RequestRecord record = repository.findByApprovalForUpdate(approvalNo, bizNo)
            .orElseThrow(() -> new IllegalArgumentException(
                "Business request was not found for ECP approval " + approvalNo));
        ObjectNode target = record.document().deepCopy();
        String localStatus = target.path("status").asText();
        target.put("approvalNo", approvalNo.isEmpty() ? target.path("approvalNo").asText() : approvalNo);
        target.put("bizNo", bizNo.isEmpty() ? target.path("bizNo").asText() : bizNo);
        target.put("approvalStatus", remoteStatus);
        target.put("approvalSyncedAt", Instant.now().toString());
        copyLong(detail, target, "instanceId");

        if (TERMINAL_STATUSES.contains(localStatus) && !matchesRemoteFinalState(localStatus, remoteStatus)) {
            target.put("approvalSyncError", "Local final state conflicts with ECP status " + remoteStatus);
            return save(record, target);
        }
        target.remove("approvalSyncError");
        switch (remoteStatus) {
            case "PENDING" -> {
                String pendingStatus = pendingStatus(target);
                if (!TERMINAL_STATUSES.contains(localStatus)) target.put("status", pendingStatus);
                target.put("currentNode", currentNodeName(detail, pendingStatus));
            }
            case "APPROVED" -> {
                if (!Set.of("已完成", "已同意", "待执行").contains(localStatus)) {
                    if (executor.supports(target.path("type").asText())) {
                        executor.execute(target, decisionOperator(target));
                        target.put("status", approvedStatus(target));
                        target.put("currentNode", "已归档");
                    } else {
                        target.put("status", "待执行");
                        target.put("currentNode", "普通管理员执行");
                    }
                    target.put("approvalExecutedAt", Instant.now().toString());
                }
            }
            case "REJECTED" -> {
                target.put("status", rejectedStatus(target));
                target.put("currentNode", "已归档");
            }
            case "CANCELED", "CANCELLED" -> {
                target.put("status", "已取消");
                target.put("currentNode", "已归档");
            }
            default -> throw new IllegalArgumentException("Unsupported ECP approval status: " + remoteStatus);
        }
        return save(record, target);
    }

    public List<String> pendingApprovalNos(int limit) {
        return repository.pendingApprovalNos(limit);
    }

    private ApprovalRequestRepository.RequestRecord lockedRequest(String requestId) {
        return repository.findForUpdate(requestId)
            .orElseThrow(() -> new IllegalArgumentException("Business item not found: " + requestId));
    }

    private JsonNode save(ApprovalRequestRepository.RequestRecord record, ObjectNode target) {
        repository.update(record, target);
        ArrayNode items = JsonNodeFactory.instance.arrayNode();
        repository.findAll().forEach(items::add);
        return items;
    }

    private void requireOpen(ObjectNode item) {
        if (!OPEN_STATUSES.contains(item.path("status").asText())) {
            throw new IllegalArgumentException("Request is already finalized");
        }
    }

    private void recordDecision(ObjectNode item, ApprovedAssetRequestExecutor.Operator operator, String reason) {
        item.put("decisionOperator", operator.name());
        item.put("decisionOperatorSubject", operator.identitySubject());
        item.put("decisionReason", text(reason));
        item.put("decisionAt", Instant.now().toString());
    }

    private ApprovedAssetRequestExecutor.Operator decisionOperator(ObjectNode item) {
        String name = text(item.path("decisionOperator").asText());
        String subject = text(item.path("decisionOperatorSubject").asText());
        return name.isEmpty()
            ? ApprovedAssetRequestExecutor.Operator.ecp()
            : new ApprovedAssetRequestExecutor.Operator(name, "", subject, subject);
    }

    private JsonNode unwrap(JsonNode detail) {
        if (detail == null || detail.isNull()) throw new IllegalArgumentException("ECP approval detail is empty");
        JsonNode data = detail.path("data");
        return data.isObject() ? data : detail;
    }

    private String remoteStatus(JsonNode detail) {
        String value = text(detail.path("process").path("status").asText());
        if (value.isEmpty()) value = text(detail.path("status").asText());
        if (value.isEmpty()) value = text(detail.path("finalStatus").asText());
        return value.toUpperCase(java.util.Locale.ROOT);
    }

    private String currentNodeName(JsonNode detail, String fallback) {
        String value = text(detail.path("process").path("currentNode").path("name").asText());
        if (value.isEmpty()) value = text(detail.path("process").path("currentNodeName").asText());
        if (value.isEmpty()) value = text(detail.path("currentNodeName").asText());
        return value.isEmpty() ? fallback : value;
    }

    private boolean matchesRemoteFinalState(String localStatus, String remoteStatus) {
        return switch (localStatus) {
            case "已完成", "已同意", "待执行" -> "APPROVED".equals(remoteStatus);
            case "已拒绝", "已驳回" -> "REJECTED".equals(remoteStatus);
            case "已取消" -> "CANCELED".equals(remoteStatus) || "CANCELLED".equals(remoteStatus);
            default -> false;
        };
    }

    private String pendingStatus(ObjectNode item) {
        return item.path("selfServiceRequest").asBoolean(false) ? "待审批" : "审批中";
    }

    private String approvedStatus(ObjectNode item) {
        return item.path("selfServiceRequest").asBoolean(false) ? "已同意" : "已完成";
    }

    private String rejectedStatus(ObjectNode item) {
        return item.path("selfServiceRequest").asBoolean(false) ? "已驳回" : "已拒绝";
    }

    private void copyLong(JsonNode source, ObjectNode target, String field) {
        long value = source.path(field).asLong(0);
        if (value > 0) target.put(field, value);
    }

    private static String text(String value) {
        return value == null ? "" : value.trim();
    }
}
