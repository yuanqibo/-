package team.acg.access.assets.approval;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.util.Map;

@RestController
@ConditionalOnProperty(prefix = "asset-portal.approval", name = "enabled", havingValue = "true")
public class ApprovalCallbackController {
    private static final int MAX_CALLBACK_BYTES = 256 * 1024;
    private final ApprovalCallbackRepository repository;
    private final String appCode;

    public ApprovalCallbackController(ApprovalCallbackRepository repository,
                                      @Value("${ecp.sdk.app-code}") String appCode) {
        this.repository = repository;
        this.appCode = required(appCode, 64, "ECP appCode is required");
    }

    @PostMapping("/api/ecp/approval/callback")
    public ResponseEntity<?> callback(@RequestBody JsonNode payload) {
        if (payload == null || !payload.isObject()) throw new IllegalArgumentException("Approval callback must be an object");
        if (payload.toString().getBytes(StandardCharsets.UTF_8).length > MAX_CALLBACK_BYTES) {
            throw new IllegalArgumentException("Approval callback is too large");
        }
        String ownerAppCode = required(payload.path("ownerAppCode").asText(), 64,
            "Approval callback ownerAppCode is required");
        if (!appCode.equals(ownerAppCode)) throw new IllegalArgumentException("Approval callback appCode does not match");
        String eventId = required(payload.path("eventId").asText(), 191, "Approval callback eventId is required");
        String approvalNo = required(payload.path("approvalNo").asText(), 191,
            "Approval callback approvalNo is required");
        String bizNo = optional(payload.path("bizNo").asText(), 191, "Approval callback bizNo is too long");
        String eventType = required(payload.path("eventType").asText(), 64,
            "Approval callback eventType is required");
        boolean accepted = repository.accept(eventId, approvalNo, bizNo, eventType, payload);
        return ResponseEntity.ok(Map.of("success", true, "accepted", accepted));
    }

    private static String required(String value, int maxLength, String message) {
        String normalized = value == null ? "" : value.trim();
        if (normalized.isEmpty() || normalized.length() > maxLength) throw new IllegalArgumentException(message);
        return normalized;
    }

    private static String optional(String value, int maxLength, String message) {
        String normalized = value == null ? "" : value.trim();
        if (normalized.length() > maxLength) throw new IllegalArgumentException(message);
        return normalized;
    }
}
