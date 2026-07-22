package team.acg.access.assets.approval;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import team.acg.access.assets.business.BusinessDataRepository;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

@Service
public class ApprovalRequestStateService {
    private static final Set<String> OPEN_STATUSES = Set.of("审批中", "待审批", "待执行");
    private static final Set<String> TERMINAL_STATUSES = Set.of("已完成", "已同意", "已拒绝", "已驳回", "已取消");
    private final BusinessDataRepository repository;
    private final ApprovedAssetRequestExecutor executor;

    public ApprovalRequestStateService(BusinessDataRepository repository, ApprovedAssetRequestExecutor executor) {
        this.repository = repository;
        this.executor = executor;
    }

    @Transactional
    public JsonNode decideLocally(String requestId, String decision, ApprovedAssetRequestExecutor.Operator operator,
                                  String reason) {
        BusinessDataRepository.Snapshot snapshot = lockedRequests();
        ArrayNode items = copyItems(snapshot);
        ObjectNode target = findById(items, requestId);
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
        return save(items, snapshot.version());
    }

    @Transactional
    public JsonNode markExternalDecisionSubmitted(String requestId, String decision,
                                                  ApprovedAssetRequestExecutor.Operator operator, String reason) {
        BusinessDataRepository.Snapshot snapshot = lockedRequests();
        ArrayNode items = copyItems(snapshot);
        ObjectNode target = findById(items, requestId);
        requireOpen(target);
        target.put("decisionSubmitted", decision);
        target.put("decisionSubmittedAt", Instant.now().toString());
        target.put("currentNode", "等待审批平台同步");
        recordDecision(target, operator, reason);
        return save(items, snapshot.version());
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

        BusinessDataRepository.Snapshot snapshot = lockedRequests();
        ArrayNode items = copyItems(snapshot);
        ObjectNode target = findByApproval(items, approvalNo, bizNo);
        String localStatus = target.path("status").asText();
        target.put("approvalNo", approvalNo.isEmpty() ? target.path("approvalNo").asText() : approvalNo);
        target.put("bizNo", bizNo.isEmpty() ? target.path("bizNo").asText() : bizNo);
        target.put("approvalStatus", remoteStatus);
        target.put("approvalSyncedAt", Instant.now().toString());
        copyLong(detail, target, "instanceId");

        if (TERMINAL_STATUSES.contains(localStatus) && !matchesRemoteFinalState(localStatus, remoteStatus)) {
            target.put("approvalSyncError", "Local final state conflicts with ECP status " + remoteStatus);
            return save(items, snapshot.version());
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
                        executor.execute(target, ApprovedAssetRequestExecutor.Operator.ecp());
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
        return save(items, snapshot.version());
    }

    public List<String> pendingApprovalNos(int limit) {
        if (limit <= 0) return List.of();
        JsonNode document = repository.find("requests").map(BusinessDataRepository.Snapshot::document).orElse(null);
        if (document == null || !document.isArray()) return List.of();
        List<String> result = new ArrayList<>();
        for (JsonNode item : document) {
            if (result.size() >= limit) break;
            String approvalNo = text(item.path("approvalNo").asText());
            if (!approvalNo.isEmpty() && OPEN_STATUSES.contains(item.path("status").asText())) result.add(approvalNo);
        }
        return List.copyOf(result);
    }

    private BusinessDataRepository.Snapshot lockedRequests() {
        return repository.findForUpdate("requests")
            .orElseThrow(() -> new IllegalArgumentException("Business request data was not found"));
    }

    private ArrayNode copyItems(BusinessDataRepository.Snapshot snapshot) {
        if (!snapshot.document().isArray()) throw new IllegalStateException("Business request snapshot is invalid");
        return (ArrayNode) snapshot.document().deepCopy();
    }

    private JsonNode save(ArrayNode items, long version) {
        return repository.update("requests", items, version)
            .orElseThrow(() -> new IllegalStateException("Business request changed while it was locked"))
            .document();
    }

    private ObjectNode findById(ArrayNode items, String id) {
        for (JsonNode item : items) {
            if (item.isObject() && id.equals(item.path("id").asText())) return (ObjectNode) item;
        }
        throw new IllegalArgumentException("Business item not found: " + id);
    }

    private ObjectNode findByApproval(ArrayNode items, String approvalNo, String bizNo) {
        for (JsonNode item : items) {
            if (!item.isObject()) continue;
            if (!approvalNo.isEmpty() && approvalNo.equals(item.path("approvalNo").asText())) return (ObjectNode) item;
            if (!bizNo.isEmpty() && (bizNo.equals(item.path("bizNo").asText()) || bizNo.equals(item.path("id").asText()))) {
                return (ObjectNode) item;
            }
        }
        throw new IllegalArgumentException("Business request was not found for ECP approval " + approvalNo);
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
