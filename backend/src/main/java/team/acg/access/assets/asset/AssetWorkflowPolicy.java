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
        JsonNode settings = storeRepository.find(SELF_SERVICE_SETTINGS_KEY)
            .map(AppStoreRepository.StoreValue::value)
            .orElse(null);
        if (settings == null || !settings.isObject()) return true;
        JsonNode policy = settings.path("signSettings").path("assetHandover");
        return !policy.isObject() || policy.path("employeeSign").asBoolean(true);
    }
}
