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
        "资产交接", "handoverAsset");
    private static final Set<String> AVAILABLE_ASSET_SETTINGS = Set.of("receiveAsset", "borrowAsset");
    private static final Map<String, Set<String>> OWNED_ASSET_STATUSES = Map.of(
        "giveBackAsset", Set.of("借用中"),
        "returnAsset", Set.of("在用"),
        "handoverAsset", Set.of("在用", "借用中"));

    private final AppStoreRepository storeRepository;
    private final AssetService assetService;

    public SelfServiceRequestPolicy(AppStoreRepository storeRepository, AssetService assetService) {
        this.storeRepository = storeRepository;
        this.assetService = assetService;
    }

    public void enforce(String requestType, String reason, JsonNode details,
                        RequestIdentityService.Identity identity) {
        if (identity.manager()) return;

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
        if (AVAILABLE_ASSET_SETTINGS.contains(settingKey)) {
            enforceAvailableAssetSelection(details, policy, identity);
        } else if (OWNED_ASSET_STATUSES.containsKey(settingKey)) {
            enforceOwnedAssetSelection(details, identity, OWNED_ASSET_STATUSES.get(settingKey));
        }
    }

    private void enforceAvailableAssetSelection(JsonNode details, JsonNode policy,
                                                RequestIdentityService.Identity identity) {
        List<String> assetIds = readAssetIds(details);
        List<JsonNode> assets = assetService.findAccessibleByIds(identity, assetIds);
        if (assets.size() != assetIds.size()) {
            throw forbidden("One or more requested assets are not accessible");
        }
        if (assets.stream().anyMatch(asset -> !assetService.isAvailable(asset))) {
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
