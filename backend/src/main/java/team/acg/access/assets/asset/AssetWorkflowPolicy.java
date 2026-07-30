package team.acg.access.assets.asset;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Service;
import team.acg.access.assets.store.AppStoreRepository;

@Service
public class AssetWorkflowPolicy {
    private static final String SELF_SERVICE_SETTINGS_KEY = "assetPortalSelfServiceSettingsV9";
    private final AppStoreRepository storeRepository;

    public AssetWorkflowPolicy(AppStoreRepository storeRepository) {
        this.storeRepository = storeRepository;
    }

    public boolean requiresEmployeeHandoverSignature() {
        return requiresEmployeeSignature("HANDOVER");
    }

    public boolean requiresEmployeeSignature(String operationType) {
        JsonNode policy = signaturePolicy(operationType);
        return policy.isObject() && (
            policy.path("employeeSign").asBoolean(false)
                || policy.path("noticeEnabled").asBoolean(false));
    }

    public String noticeContent(String operationType) {
        JsonNode policy = signaturePolicy(operationType);
        return policy.path("noticeEnabled").asBoolean(false)
            ? policy.path("noticeContent").asText("").trim()
            : "";
    }

    public boolean requiresEmployeeSignature(String operationType, boolean selfService) {
        if (!selfService) return requiresEmployeeSignature(operationType);
        JsonNode policy = selfServiceSignaturePolicy(operationType);
        return policy.path("timings").path("receive").asBoolean(false);
    }

    public String noticeContent(String operationType, boolean selfService) {
        JsonNode policy = selfService ? selfServiceSignaturePolicy(operationType) : signaturePolicy(operationType);
        return policy.path("noticeEnabled").asBoolean(false)
            ? policy.path("noticeContent").asText("").trim() : "";
    }

    private JsonNode signaturePolicy(String operationType) {
        JsonNode settings = storeRepository.find(SELF_SERVICE_SETTINGS_KEY)
            .map(AppStoreRepository.StoreValue::value)
            .orElse(null);
        if (settings == null || !settings.isObject()) return com.fasterxml.jackson.databind.node.MissingNode.getInstance();
        String key = switch (operationType == null ? "" : operationType.trim().toUpperCase()) {
            case "RECEIVE" -> "assetReceive";
            case "BORROW" -> "assetBorrow";
            case "HANDOVER" -> "assetHandover";
            default -> "";
        };
        return key.isEmpty() ? com.fasterxml.jackson.databind.node.MissingNode.getInstance()
            : settings.path("signSettings").path(key);
    }

    private JsonNode selfServiceSignaturePolicy(String operationType) {
        JsonNode settings = storeRepository.find(SELF_SERVICE_SETTINGS_KEY)
            .map(AppStoreRepository.StoreValue::value)
            .orElse(null);
        if (settings == null || !settings.isObject()) return com.fasterxml.jackson.databind.node.MissingNode.getInstance();
        String key = switch (operationType == null ? "" : operationType.trim().toUpperCase()) {
            case "RECEIVE" -> "selfReceiveAsset";
            case "BORROW" -> "selfBorrowAsset";
            case "HANDOVER" -> "selfHandoverAsset";
            default -> "";
        };
        return key.isEmpty() ? com.fasterxml.jackson.databind.node.MissingNode.getInstance()
            : settings.path("signSettings").path(key);
    }
}
