package team.acg.access.assets.store;

import com.fasterxml.jackson.databind.JsonNode;
import com.idanchuang.ecp.sdk.spring.annotation.RequirePermission;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.Map;

@RestController
@RequestMapping("/api/config")
public class PortalConfigController {
    private static final Map<String, String> SECURITY = Map.of(
        "users", "assetPortalRegisteredUsers",
        "roles", "assetPortalRoleDefinitionsV3",
        "deleted-users", "assetPortalDeletedRoleUsersV1");
    private static final Map<String, String> CATALOG = Map.of(
        "categories", "assetCategoryTree",
        "category-version", "assetCategoryTreeVersion",
        "locations", "assetLocationTree");
    private static final Map<String, String> SETTINGS = Map.of(
        "asset-code", "assetPortalAssetCodeRuleSettingsV1",
        "self-service", "assetPortalSelfServiceSettingsV9");

    private final AppStoreRepository repository;
    private final PortalDocumentValidator validator;

    public PortalConfigController(AppStoreRepository repository, PortalDocumentValidator validator) {
        this.repository = repository;
        this.validator = validator;
    }

    @PutMapping("/security/{domain}")
    @RequirePermission(permissions = "authz:app_role:assign")
    public Map<String, Object> saveSecurity(@PathVariable String domain, @RequestBody ConfigWrite request) {
        return save(SECURITY, domain, request);
    }

    @PutMapping("/catalog/{domain}")
    @RequirePermission(permissions = "asset:update")
    public Map<String, Object> saveCatalog(@PathVariable String domain, @RequestBody ConfigWrite request) {
        return save(CATALOG, domain, request);
    }

    @PutMapping("/settings/{domain}")
    @RequirePermission(permissions = "asset:update")
    public Map<String, Object> saveSettings(@PathVariable String domain, @RequestBody ConfigWrite request) {
        return save(SETTINGS, domain, request);
    }

    private Map<String, Object> save(Map<String, String> domains, String domain, ConfigWrite request) {
        String key = domains.get(domain);
        if (key == null) throw new IllegalArgumentException("Unsupported portal configuration domain: " + domain);
        if (request.value() == null || request.value().isNull()) throw new IllegalArgumentException("Portal configuration cannot be null");
        validator.validate(key, request.value());
        Instant updatedAt = repository.saveAll(Map.of(key, request.value()));
        return Map.of("ok", true, "domain", domain, "updatedAt", updatedAt);
    }

    public record ConfigWrite(JsonNode value) {}
}
