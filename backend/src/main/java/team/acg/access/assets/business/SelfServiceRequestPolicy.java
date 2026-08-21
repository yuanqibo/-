package team.acg.access.assets.business;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import team.acg.access.assets.asset.AssetService;
import team.acg.access.assets.auth.RequestIdentityService;
import team.acg.access.assets.store.AppStoreRepository;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

@Service
public class SelfServiceRequestPolicy {
    static final String SETTINGS_KEY = "assetPortalSelfServiceSettingsV9";
    private static final int MAX_REQUEST_ASSETS = 100;
    private static final Map<String, String> REQUEST_SETTING_KEYS = Map.of(
        "资产领用", "receiveAsset",
        "资产借用", "borrowAsset",
        "资产归还", "giveBackAsset",
        "资产退还", "returnAsset",
        "资产交接", "handoverAsset",
        "办公设备申领", "deviceRequest");
    private static final Map<String, String> REQUEST_SIGNATURE_KEYS = Map.of(
        "资产领用", "selfReceiveAsset",
        "资产借用", "selfBorrowAsset",
        "资产归还", "selfGiveBackAsset",
        "资产交接", "selfHandoverAsset");
    private static final Set<String> AVAILABLE_ASSET_SETTINGS = Set.of("receiveAsset", "borrowAsset");
    private static final Set<String> CONFIGURABLE_APPROVAL_SETTINGS = Set.of(
        "receiveAsset", "borrowAsset", "handoverAsset");
    private static final Map<String, Set<String>> OWNED_ASSET_STATUSES = Map.of(
        "giveBackAsset", Set.of("借用", "借用中"),
        "returnAsset", Set.of("领用"),
        "handoverAsset", Set.of("领用", "借用", "借用中"));

    private final AppStoreRepository storeRepository;
    private final AssetService assetService;

    public SelfServiceRequestPolicy(AppStoreRepository storeRepository, AssetService assetService) {
        this.storeRepository = storeRepository;
        this.assetService = assetService;
    }

    public void enforce(String requestType, String reason, JsonNode details,
                        RequestIdentityService.Identity identity) {
        String normalizedType = requestType == null ? "" : requestType.trim();
        String settingKey = REQUEST_SETTING_KEYS.get(normalizedType);
        if (settingKey == null) {
            throw forbidden("Unsupported employee self-service request type: " + normalizedType);
        }

        JsonNode settings = storeRepository.find(SETTINGS_KEY)
            .map(AppStoreRepository.StoreValue::value)
            .orElseThrow(() -> new ResponseStatusException(
                HttpStatus.SERVICE_UNAVAILABLE, "Employee self-service settings are unavailable"));
        JsonNode policy = settings.path(settingKey);
        if (!policy.isObject() || !policy.path("enabled").asBoolean(false)) {
            throw forbidden("Employee self-service request is disabled: " + normalizedType);
        }
        if (policy.path("remarkRequired").asBoolean(false) && (reason == null || reason.isBlank())) {
            throw new IllegalArgumentException("Request reason is required");
        }
        enforceRequestSignature(normalizedType, details, settings);
        if ("deviceRequest".equals(settingKey)) {
            enforceDeviceRequest(details, policy);
        } else if (AVAILABLE_ASSET_SETTINGS.contains(settingKey)) {
            enforceAvailableAssetSelection(details, policy, identity, settingKey);
        } else if (OWNED_ASSET_STATUSES.containsKey(settingKey)) {
            enforceOwnedAssetSelection(details, identity, OWNED_ASSET_STATUSES.get(settingKey));
        }
        if ("receiveAsset".equals(settingKey)) enforceReceiveDetails(details);
        if ("borrowAsset".equals(settingKey)) enforceBorrowDetails(details);
        if (Set.of("giveBackAsset", "returnAsset").contains(settingKey)) enforceReturnDetails(details);
        if ("handoverAsset".equals(settingKey)) enforceHandoverTarget(details, identity);
    }

    private void enforceRequestSignature(String requestType, JsonNode details, JsonNode settings) {
        String signatureKey = REQUEST_SIGNATURE_KEYS.get(requestType);
        if (signatureKey == null) return;
        JsonNode signature = settings.path("signSettings").path(signatureKey);
        if (signature.path("noticeEnabled").asBoolean(false)
            && (details == null || !details.path("noticeAcknowledged").asBoolean(false))) {
            throw new IllegalArgumentException("Employee must acknowledge the configured request notice");
        }
        String timingKey = "资产归还".equals(requestType) ? "return"
            : Set.of("资产领用", "资产借用").contains(requestType) ? "start" : "";
        boolean required = !timingKey.isEmpty()
            && signature.path("timings").path(timingKey).asBoolean(false);
        if (!required) return;
        String image = details == null ? "" : details.path("signatureImage").asText("").trim();
        if (!image.matches("^data:image/(png|jpeg);base64,[A-Za-z0-9+/=]+$") || image.length() > 700_000) {
            throw new IllegalArgumentException("Employee signature is required before submitting this request");
        }
    }

    private void enforceDeviceRequest(JsonNode details, JsonNode policy) {
        JsonNode items = details == null ? null : details.get("deviceItems");
        if (items == null || !items.isArray() || items.isEmpty() || items.size() > 20) {
            throw new IllegalArgumentException("A device request must contain between 1 and 20 items");
        }
        if (!policy.path("allowEmployeeAddDevice").asBoolean(false) && items.size() > 1) {
            throw new IllegalArgumentException("Multiple device items are disabled for employee requests");
        }
        for (JsonNode item : items) {
            if (!item.isObject()) throw new IllegalArgumentException("Device request items must be objects");
            String name = item.path("name").asText("").trim();
            String specification = item.path("specification").asText("").trim();
            int quantity = item.path("quantity").asInt(0);
            if (name.isEmpty() || name.length() > 128) {
                throw new IllegalArgumentException("Device name is required and cannot exceed 128 characters");
            }
            if (specification.length() > 500) {
                throw new IllegalArgumentException("Device specification cannot exceed 500 characters");
            }
            if (quantity < 1 || quantity > 100) {
                throw new IllegalArgumentException("Device quantity must be between 1 and 100");
            }
        }
    }

    public boolean requiresApproval(String requestType) {
        String settingKey = REQUEST_SETTING_KEYS.get(requestType == null ? "" : requestType.trim());
        if (!CONFIGURABLE_APPROVAL_SETTINGS.contains(settingKey)) return true;
        JsonNode settings = storeRepository.find(SETTINGS_KEY)
            .map(AppStoreRepository.StoreValue::value)
            .orElseThrow(() -> new ResponseStatusException(
                HttpStatus.SERVICE_UNAVAILABLE, "Employee self-service settings are unavailable"));
        JsonNode policy = settings.path(settingKey);
        return !policy.isObject() || policy.path("approvalRequired").asBoolean(true);
    }

    private void enforceAvailableAssetSelection(JsonNode details, JsonNode policy,
                                                RequestIdentityService.Identity identity, String settingKey) {
        List<String> assetIds = readAssetIds(details);
        List<JsonNode> assets = assetService.findAccessibleByIds(identity, assetIds);
        if (assets.size() != assetIds.size()) {
            throw forbidden("One or more requested assets are not accessible");
        }
        boolean invalidStatus = assets.stream().anyMatch(asset ->
            !"空闲".equals(asset.path("status").asText()));
        if (invalidStatus) {
            throw new IllegalArgumentException("Requested assets must be available for self-service");
        }

        Set<String> allowedCategories = new LinkedHashSet<>();
        JsonNode categories = policy.path("categories");
        if (categories.isArray()) {
            categories.forEach(category -> {
                if (category.isTextual() && !category.asText().isBlank()) {
                    allowedCategories.add(category.asText().trim());
                }
            });
        }
        Set<String> rejectedCategories = assets.stream()
            .map(asset -> asset.path("category").asText("").trim())
            .filter(category -> !allowedCategories.contains(category))
            .collect(Collectors.toCollection(LinkedHashSet::new));
        if (!rejectedCategories.isEmpty()) {
            throw new IllegalArgumentException(
                "Requested asset category is not enabled for self-service: " + String.join(", ", rejectedCategories));
        }
    }

    private void enforceOwnedAssetSelection(JsonNode details, RequestIdentityService.Identity identity,
                                            Set<String> allowedStatuses) {
        List<String> assetIds = readAssetIds(details);
        List<JsonNode> assets = assetService.findAccessibleByIds(identity, assetIds);
        if (assets.size() != assetIds.size()) {
            throw forbidden("One or more requested assets are not accessible");
        }
        boolean invalidOwner = assets.stream().anyMatch(asset -> {
            String ownerSubject = asset.path("ownerSubject").asText("").trim();
            return ownerSubject.isEmpty()
                || !ownerSubject.equals(identity.subject()) && !ownerSubject.equals(identity.directorySubject());
        });
        if (invalidOwner) throw forbidden("Requested assets must belong to the current employee");
        if (assets.stream().anyMatch(asset -> !allowedStatuses.contains(asset.path("status").asText()))) {
            throw new IllegalArgumentException("Requested assets are not eligible for this self-service action");
        }
    }

    private void enforceHandoverTarget(JsonNode details, RequestIdentityService.Identity identity) {
        String receiverSubject = details == null ? "" : details.path("receiverSubject").asText("").trim();
        String receiverName = details == null ? "" : details.path("receiverName").asText("").trim();
        if (receiverSubject.isEmpty() || receiverName.isEmpty()) {
            throw new IllegalArgumentException("A directory receiver is required for asset handover");
        }
        if (receiverSubject.equals(identity.subject()) || receiverSubject.equals(identity.directorySubject())) {
            throw new IllegalArgumentException("Asset handover receiver must be another employee");
        }
    }

    private void enforceReturnDetails(JsonNode details) {
        String location = details == null ? "" : details.path("returnLocation").asText("").trim();
        String date = details == null ? "" : details.path("returnDate").asText("").trim();
        if (location.isEmpty()) throw new IllegalArgumentException("Return location is required");
        if (date.isEmpty()) throw new IllegalArgumentException("Return date is required");
        try {
            java.time.LocalDate.parse(date);
        } catch (java.time.format.DateTimeParseException error) {
            throw new IllegalArgumentException("Return date must use ISO format YYYY-MM-DD");
        }
    }

    private void enforceReceiveDetails(JsonNode details) {
        String receiveType = details == null ? "" : details.path("receiveType").asText("").trim();
        String location = details == null ? "" : details.path("receiveLocation").asText("").trim();
        String date = details == null ? "" : details.path("receiveDate").asText("").trim();
        if (!"个人领用".equals(receiveType)) {
            throw new IllegalArgumentException("Self-service receive type must be personal");
        }
        if (location.isEmpty()) throw new IllegalArgumentException("Receive location is required");
        if (date.isEmpty()) throw new IllegalArgumentException("Receive date is required");
        try {
            java.time.LocalDate.parse(date);
        } catch (java.time.format.DateTimeParseException error) {
            throw new IllegalArgumentException("Receive date must use ISO format YYYY-MM-DD");
        }
    }

    private void enforceBorrowDetails(JsonNode details) {
        String location = details == null ? "" : details.path("borrowLocation").asText("").trim();
        String date = details == null ? "" : details.path("borrowDate").asText("").trim();
        String expectedReturnDate = details == null ? "" : details.path("expectedReturnDate").asText("").trim();
        if (location.isEmpty()) throw new IllegalArgumentException("Borrow location is required");
        if (date.isEmpty()) throw new IllegalArgumentException("Borrow date is required");
        if (expectedReturnDate.isEmpty()) throw new IllegalArgumentException("Expected return date is required");
        try {
            java.time.LocalDate borrowDate = java.time.LocalDate.parse(date);
            java.time.LocalDate returnDate = java.time.LocalDate.parse(expectedReturnDate);
            if (returnDate.isBefore(borrowDate)) {
                throw new IllegalArgumentException("Expected return date cannot be before borrow date");
            }
        } catch (java.time.format.DateTimeParseException error) {
            throw new IllegalArgumentException("Borrow dates must use ISO format YYYY-MM-DD");
        }
    }

    private List<String> readAssetIds(JsonNode details) {
        JsonNode values = details == null ? null : details.get("assetIds");
        if (values == null || !values.isArray() || values.isEmpty()) {
            throw new IllegalArgumentException("At least one asset id is required");
        }
        LinkedHashSet<String> ids = new LinkedHashSet<>();
        values.forEach(value -> {
            if (!value.isTextual() || value.asText().isBlank()) {
                throw new IllegalArgumentException("Asset ids must be non-empty strings");
            }
            String id = value.asText().trim();
            if (!ids.add(id)) throw new IllegalArgumentException("Duplicate asset id: " + id);
            if (ids.size() > MAX_REQUEST_ASSETS) {
                throw new IllegalArgumentException("A self-service request cannot contain more than 100 assets");
            }
        });
        return List.copyOf(ids);
    }

    private ResponseStatusException forbidden(String message) {
        return new ResponseStatusException(HttpStatus.FORBIDDEN, message);
    }
}
