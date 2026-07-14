package team.acg.access.assets.store;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.TextNode;
import com.idanchuang.ecp.sdk.spring.annotation.PermissionSpec;
import com.idanchuang.ecp.sdk.spring.annotation.RequireAnyPermission;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Map;
import java.util.Set;
import team.acg.access.assets.auth.RequestIdentityService;
import team.acg.access.assets.asset.AssetService;

@RestController
@RequestMapping("/api/config")
public class PortalConfigController {
    private static final Map<String, ConfigDomain> CATALOG = Map.of(
        "categories", new ConfigDomain("assetCategoryTree", "asset:category_settings:update"),
        "category-version", new ConfigDomain("assetCategoryTreeVersion", "asset:category_settings:update"),
        "locations", new ConfigDomain("assetLocationTree", "asset:location_settings:update"));
    private static final Map<String, ConfigDomain> SETTINGS = Map.of(
        "asset-code", new ConfigDomain("assetPortalAssetCodeRuleSettingsV1", "asset:code_rules:update"),
        "self-service", new ConfigDomain("assetPortalSelfServiceSettingsV9", "asset:self_service:update"));

    private final AppStoreRepository repository;
    private final PortalDocumentValidator validator;
    private final RequestIdentityService identityService;
    private final PortalReferenceCatalog referenceCatalog;
    private final AssetService assetService;

    public PortalConfigController(AppStoreRepository repository, PortalDocumentValidator validator,
                                  RequestIdentityService identityService, PortalReferenceCatalog referenceCatalog,
                                  AssetService assetService) {
        this.repository = repository;
        this.validator = validator;
        this.identityService = identityService;
        this.referenceCatalog = referenceCatalog;
        this.assetService = assetService;
    }

    @PutMapping("/catalog/{domain}")
    @RequireAnyPermission({
        @PermissionSpec("asset:category_settings:create"),
        @PermissionSpec("asset:category_settings:update"),
        @PermissionSpec("asset:category_settings:delete"),
        @PermissionSpec("asset:category_settings:toggleCode"),
        @PermissionSpec("asset:location_settings:create"),
        @PermissionSpec("asset:location_settings:update"),
        @PermissionSpec("asset:location_settings:delete"),
        @PermissionSpec("asset:location_settings:toggleCode")
    })
    @Transactional
    public Map<String, Object> saveCatalog(@PathVariable String domain, @RequestBody ConfigWrite request,
                                           HttpServletRequest servletRequest) {
        ConfigDomain config = requireDomain(CATALOG, domain);
        JsonNode value = requireValue(request);
        validator.validate(config.key(), value);
        if (!Set.of(PortalReferenceCatalog.CATEGORY_KEY, PortalReferenceCatalog.LOCATION_KEY).contains(config.key())) {
            identityService.requirePermission(servletRequest, config.permission());
            Instant updatedAt = repository.saveAll(Map.of(config.key(), value));
            return Map.of("ok", true, "domain", domain, "updatedAssets", 0, "updatedAt", updatedAt);
        }
        PortalReferenceCatalog.ReferenceChange referenceChange = referenceCatalog.changes(config.key(), value);
        requireCatalogPermissions(servletRequest, config.key(), referenceChange);
        Map<String, JsonNode> values = PortalReferenceCatalog.CATEGORY_KEY.equals(config.key())
            ? Map.of(config.key(), value, "assetCategoryTreeVersion", TextNode.valueOf("server-" + Instant.now().toEpochMilli()))
            : Map.of(config.key(), value);
        Instant updatedAt = repository.saveAll(values);
        int updatedAssets = assetService.applyReferenceChanges(referenceChange);
        return Map.of("ok", true, "domain", domain, "updatedAssets", updatedAssets, "updatedAt", updatedAt);
    }

    @PutMapping("/settings/{domain}")
    @RequireAnyPermission({
        @PermissionSpec("asset:code_rules:update"),
        @PermissionSpec("asset:self_service:update")
    })
    public Map<String, Object> saveSettings(@PathVariable String domain, @RequestBody ConfigWrite request,
                                            HttpServletRequest servletRequest) {
        return save(SETTINGS, domain, request, servletRequest);
    }

    private Map<String, Object> save(Map<String, ConfigDomain> domains, String domain, ConfigWrite request,
                                     HttpServletRequest servletRequest) {
        ConfigDomain config = requireDomain(domains, domain);
        identityService.requirePermission(servletRequest, config.permission());
        JsonNode value = requireValue(request);
        validator.validate(config.key(), value);
        Instant updatedAt = repository.saveAll(Map.of(config.key(), value));
        return Map.of("ok", true, "domain", domain, "updatedAt", updatedAt);
    }

    private ConfigDomain requireDomain(Map<String, ConfigDomain> domains, String domain) {
        ConfigDomain config = domains.get(domain);
        if (config == null) throw new IllegalArgumentException("Unsupported portal configuration domain: " + domain);
        return config;
    }

    private JsonNode requireValue(ConfigWrite request) {
        if (request == null || request.value() == null || request.value().isNull()) {
            throw new IllegalArgumentException("Portal configuration cannot be null");
        }
        return request.value();
    }

    private void requireCatalogPermissions(HttpServletRequest request, String key,
                                           PortalReferenceCatalog.ReferenceChange change) {
        String resource = PortalReferenceCatalog.CATEGORY_KEY.equals(key)
            ? "asset:category_settings:" : "asset:location_settings:";
        boolean checked = false;
        if (change.created()) {
            identityService.requirePermission(request, resource + "create");
            checked = true;
        }
        if (change.deleted()) {
            identityService.requirePermission(request, resource + "delete");
            checked = true;
        }
        if (change.updated()) {
            identityService.requirePermission(request, resource + "update");
            checked = true;
        }
        if (change.toggled()) {
            identityService.requirePermission(request, resource + "toggleCode");
            checked = true;
        }
        if (!checked) identityService.requirePermission(request, resource + "update");
    }

    private record ConfigDomain(String key, String permission) {}
    public record ConfigWrite(JsonNode value) {}
}
