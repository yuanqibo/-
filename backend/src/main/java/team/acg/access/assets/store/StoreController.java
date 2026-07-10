package team.acg.access.assets.store;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.idanchuang.ecp.sdk.spring.annotation.RequirePermission;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

@RestController
@RequestMapping("/api/store")
public class StoreController {
    private static final String MIGRATED_ASSET_KEY = "assetPortalAssets";
    private static final Set<String> ARRAY_DOCUMENTS = Set.of(
        "assetLabelCustomTemplatesV1", "assetPortalRegisteredUsers", "assetPortalDeletedRoleUsersV1",
        "assetCategoryTree", "assetLocationTree");
    private static final Set<String> OBJECT_DOCUMENTS = Set.of(
        "assetLabelPrintSettingsV2", "assetPortalRoleDefinitionsV3", "assetPortalAssetCodeRuleSettingsV1",
        "assetPortalSelfServiceSettingsV9");
    private static final Set<String> VERSION_DOCUMENTS = Set.of("assetCategoryTreeVersion");
    private static final Set<String> ALLOWED_DOCUMENTS = Set.of(
        "assetLabelPrintSettingsV2", "assetLabelCustomTemplatesV1");
    private final AppStoreRepository repository;
    private final ObjectMapper mapper;
    private final int maxKeys;
    private final int maxValueBytes;
    private final PortalDocumentValidator documentValidator;

    public StoreController(AppStoreRepository repository, ObjectMapper mapper, PortalDocumentValidator documentValidator,
                           @Value("${asset-portal.store.max-keys-per-request}") int maxKeys,
                           @Value("${asset-portal.store.max-value-bytes}") int maxValueBytes) {
        this.repository = repository;
        this.mapper = mapper;
        this.documentValidator = documentValidator;
        this.maxKeys = maxKeys;
        this.maxValueBytes = maxValueBytes;
    }

    @GetMapping
    @RequirePermission(permissions = "asset:view")
    public Map<String, Object> list() {
        Map<String, JsonNode> values = new LinkedHashMap<>();
        Map<String, Instant> updatedAt = new LinkedHashMap<>();
        repository.findAll().forEach((key, record) -> {
            values.put(key, record.value());
            updatedAt.put(key, record.updatedAt());
        });
        return Map.of("values", values, "updatedAt", updatedAt);
    }

    @GetMapping("/item")
    @RequirePermission(permissions = "asset:view")
    public ResponseEntity<?> get(@RequestParam String key) {
        validateKey(key);
        return repository.find(key)
            .<ResponseEntity<?>>map(value -> ResponseEntity.ok(Map.of(
                "key", key, "found", true, "value", value.value(), "updatedAt", value.updatedAt())))
            .orElseGet(() -> ResponseEntity.ok(Map.of("key", key, "found", false, "value", mapper.nullNode(), "updatedAt", "")));
    }

    @PostMapping
    @RequirePermission(permissions = "asset:update")
    public Map<String, Object> save(@RequestBody StoreWriteRequest request) {
        Map<String, JsonNode> entries = request.entries();
        if (entries.isEmpty() || entries.size() > maxKeys) {
            throw new IllegalArgumentException("Store request must contain between 1 and " + maxKeys + " keys");
        }
        entries.forEach((key, value) -> {
            validateKey(key);
            validateDocument(key, value);
            documentValidator.validate(key, value);
            if (value.toString().getBytes(StandardCharsets.UTF_8).length > maxValueBytes) {
                throw new IllegalArgumentException("Store value is too large: " + key);
            }
        });
        return Map.of("ok", true, "updatedAt", repository.saveAll(entries));
    }

    private void validateKey(String key) {
        if (key == null || !key.matches("[A-Za-z0-9_.:-]{1,120}")) {
            throw new IllegalArgumentException("Invalid store key");
        }
        if (MIGRATED_ASSET_KEY.equals(key)) {
            throw new IllegalArgumentException("assetPortalAssets has migrated to /api/assets");
        }
        if (!ALLOWED_DOCUMENTS.contains(key)) {
            throw new IllegalArgumentException("Unsupported portal data document: " + key);
        }
    }

    private void validateDocument(String key, JsonNode value) {
        if (value == null || value.isNull()) {
            throw new IllegalArgumentException("Portal data document cannot be null: " + key);
        }
        if (ARRAY_DOCUMENTS.contains(key) && !value.isArray()) {
            throw new IllegalArgumentException("Portal data document must be an array: " + key);
        }
        if (OBJECT_DOCUMENTS.contains(key) && !value.isObject()) {
            throw new IllegalArgumentException("Portal data document must be an object: " + key);
        }
        if (VERSION_DOCUMENTS.contains(key) && !(value.isTextual() || value.isIntegralNumber())) {
            throw new IllegalArgumentException("Portal data version must be a string or integer: " + key);
        }
    }

    public record StoreWriteRequest(String key, JsonNode value, Map<String, JsonNode> items) {
        Map<String, JsonNode> entries() {
            if (items != null) return items;
            return key == null ? Map.of() : Map.of(key, value == null ? mapperNull() : value);
        }

        private static JsonNode mapperNull() {
            return com.fasterxml.jackson.databind.node.NullNode.getInstance();
        }
    }
}
