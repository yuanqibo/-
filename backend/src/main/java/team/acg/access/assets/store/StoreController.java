package team.acg.access.assets.store;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.idanchuang.ecp.sdk.spring.annotation.PermissionSpec;
import com.idanchuang.ecp.sdk.spring.annotation.RequireAnyPermission;
import com.idanchuang.ecp.sdk.spring.annotation.RequirePermission;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import team.acg.access.assets.auth.RequestIdentityService;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

@RestController
@RequestMapping("/api/store")
public class StoreController {
    private static final String MIGRATED_ASSET_KEY = "assetPortalAssets";
    private static final Set<String> ARRAY_DOCUMENTS = Set.of("assetLabelCustomTemplatesV1");
    private static final Set<String> OBJECT_DOCUMENTS = Set.of("assetLabelPrintSettingsV2");
    private static final Map<String, Set<String>> DOCUMENT_VIEW_PERMISSIONS = Map.of(
        "assetCategoryTree", Set.of("asset:category_settings:view", "asset:item:view"),
        "assetCategoryTreeVersion", Set.of("asset:category_settings:view", "asset:item:view"),
        "assetLocationTree", Set.of("asset:location_settings:view", "asset:item:view"),
        "assetPortalAssetCodeRuleSettingsV1", Set.of("asset:code_rules:view"),
        "assetLabelPrintSettingsV2", Set.of("asset:label_template_settings:view"),
        "assetLabelCustomTemplatesV1", Set.of("asset:label_template_settings:view"),
        "assetPortalSelfServiceSettingsV9", Set.of("asset:self_service:view"));
    private static final Set<String> LABEL_DOCUMENTS = Set.of(
        "assetLabelPrintSettingsV2", "assetLabelCustomTemplatesV1");
    private static final String PRINT_SETTINGS_KEY = "assetLabelPrintSettingsV2";
    private static final String CUSTOM_TEMPLATES_KEY = "assetLabelCustomTemplatesV1";
    private final AppStoreRepository repository;
    private final ObjectMapper mapper;
    private final int maxValueBytes;
    private final PortalDocumentValidator documentValidator;
    private final RequestIdentityService identityService;

    public StoreController(AppStoreRepository repository, ObjectMapper mapper, PortalDocumentValidator documentValidator,
                           RequestIdentityService identityService,
                           @Value("${asset-portal.store.max-value-bytes}") int maxValueBytes) {
        this.repository = repository;
        this.mapper = mapper;
        this.documentValidator = documentValidator;
        this.identityService = identityService;
        this.maxValueBytes = maxValueBytes;
    }

    @GetMapping
    @RequireAnyPermission({
        @PermissionSpec("asset:item:view"),
        @PermissionSpec("asset:category_settings:view"),
        @PermissionSpec("asset:location_settings:view"),
        @PermissionSpec("asset:code_rules:view"),
        @PermissionSpec("asset:label_template_settings:view"),
        @PermissionSpec("asset:self_service:view")
    })
    public Map<String, Object> list(HttpServletRequest request) {
        Map<String, JsonNode> values = new LinkedHashMap<>();
        Map<String, Instant> updatedAt = new LinkedHashMap<>();
        var identity = identityService.current(request);
        repository.findAll().forEach((key, record) -> {
            Set<String> permissions = DOCUMENT_VIEW_PERMISSIONS.get(key);
            if (permissions != null && identity
                .map(value -> permissions.stream().anyMatch(value::hasPermission))
                .orElse(true)) {
                values.put(key, record.value());
                updatedAt.put(key, record.updatedAt());
            }
        });
        return Map.of("values", values, "updatedAt", updatedAt);
    }

    @GetMapping("/item")
    @RequirePermission(permissions = "asset:label_template_settings:view")
    public ResponseEntity<?> get(@RequestParam String key) {
        validateLabelKey(key);
        return repository.find(key)
            .<ResponseEntity<?>>map(value -> ResponseEntity.ok(Map.of(
                "key", key, "found", true, "value", value.value(), "updatedAt", value.updatedAt())))
            .orElseGet(() -> ResponseEntity.ok(Map.of("key", key, "found", false, "value", mapper.nullNode(), "updatedAt", "")));
    }

    @PostMapping
    @Transactional
    @RequireAnyPermission({
        @PermissionSpec("asset:label_template_settings:create"),
        @PermissionSpec("asset:label_template_settings:update"),
        @PermissionSpec("asset:label_template_settings:delete"),
        @PermissionSpec("asset:label_template_settings:save"),
        @PermissionSpec("asset:label_template_settings:reset")
    })
    public Map<String, Object> save(@RequestBody StoreWriteRequest request, HttpServletRequest servletRequest) {
        if (request.items() != null) {
            throw new IllegalArgumentException("Label settings writes must contain exactly one key");
        }
        Map<String, JsonNode> entries = request.entries();
        if (entries.size() != 1) {
            throw new IllegalArgumentException("Label settings writes must contain exactly one key");
        }
        LabelOperation operation = LabelOperation.parse(request.operation());
        entries.forEach((key, value) -> {
            validateLabelKey(key);
            validateOperationKey(operation, key);
            identityService.requirePermission(servletRequest, operation.permission());
            validateDocument(key, value);
            documentValidator.validate(key, value);
            if (value.toString().getBytes(StandardCharsets.UTF_8).length > maxValueBytes) {
                throw new IllegalArgumentException("Store value is too large: " + key);
            }
            if (CUSTOM_TEMPLATES_KEY.equals(key)) {
                JsonNode current = repository.findForUpdate(key)
                    .map(AppStoreRepository.StoreValue::value)
                    .orElseGet(mapper::createArrayNode);
                validateTemplateDifference(operation, current, value);
            } else {
                repository.findForUpdate(key);
            }
        });
        return Map.of("ok", true, "updatedAt", repository.saveAll(entries));
    }

    private void validateOperationKey(LabelOperation operation, String key) {
        boolean customTemplateOperation = switch (operation) {
            case CREATE, UPDATE, DELETE -> true;
            case SAVE, RESET -> false;
        };
        String expectedKey = customTemplateOperation ? CUSTOM_TEMPLATES_KEY : PRINT_SETTINGS_KEY;
        if (!expectedKey.equals(key)) {
            throw new IllegalArgumentException("Operation " + operation.value + " is not allowed for " + key);
        }
    }

    private void validateTemplateDifference(LabelOperation operation, JsonNode current, JsonNode replacement) {
        Map<String, JsonNode> before = templatesByKey(current);
        Map<String, JsonNode> after = templatesByKey(replacement);
        Set<String> added = new HashSet<>(after.keySet());
        added.removeAll(before.keySet());
        Set<String> removed = new HashSet<>(before.keySet());
        removed.removeAll(after.keySet());
        long changed = before.keySet().stream()
            .filter(after::containsKey)
            .filter(key -> !before.get(key).equals(after.get(key)))
            .count();

        boolean valid = switch (operation) {
            case CREATE -> added.size() == 1 && removed.isEmpty() && changed == 0;
            case UPDATE -> added.isEmpty() && removed.isEmpty() && changed == 1;
            case DELETE -> added.isEmpty() && removed.size() == 1 && changed == 0;
            case SAVE, RESET -> false;
        };
        if (!valid) {
            throw new IllegalArgumentException("Declared label template operation does not match the document change");
        }
    }

    private Map<String, JsonNode> templatesByKey(JsonNode templates) {
        if (templates == null || !templates.isArray()) {
            throw new IllegalArgumentException("Custom label templates must be an array");
        }
        Map<String, JsonNode> values = new LinkedHashMap<>();
        for (JsonNode template : templates) {
            if (!template.isObject()) throw new IllegalArgumentException("Custom label templates must be objects");
            String key = template.path("key").asText("").trim();
            if (!key.matches("[A-Za-z0-9_-]{1,120}")) {
                throw new IllegalArgumentException("Custom label template key is invalid");
            }
            if (values.putIfAbsent(key, template) != null) {
                throw new IllegalArgumentException("Duplicate custom label template key: " + key);
            }
        }
        return values;
    }

    private void validateLabelKey(String key) {
        validateKeyFormat(key);
        if (!LABEL_DOCUMENTS.contains(key)) {
            throw new IllegalArgumentException("Unsupported portal data document: " + key);
        }
    }

    private void validateKeyFormat(String key) {
        if (key == null || !key.matches("[A-Za-z0-9_.:-]{1,120}")) {
            throw new IllegalArgumentException("Invalid store key");
        }
        if (MIGRATED_ASSET_KEY.equals(key)) {
            throw new IllegalArgumentException("assetPortalAssets has migrated to /api/assets");
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
    }

    private enum LabelOperation {
        CREATE("create"), UPDATE("update"), DELETE("delete"), SAVE("save"), RESET("reset");

        private final String value;

        LabelOperation(String value) {
            this.value = value;
        }

        static LabelOperation parse(String value) {
            if (value != null) {
                for (LabelOperation operation : values()) {
                    if (operation.value.equals(value.trim())) return operation;
                }
            }
            throw new IllegalArgumentException("Unsupported label settings operation");
        }

        String permission() {
            return "asset:label_template_settings:" + value;
        }
    }

    public record StoreWriteRequest(String operation, String key, JsonNode value, Map<String, JsonNode> items) {
        Map<String, JsonNode> entries() {
            if (items != null) return items;
            return key == null ? Map.of() : Map.of(key, value == null ? mapperNull() : value);
        }

        private static JsonNode mapperNull() {
            return com.fasterxml.jackson.databind.node.NullNode.getInstance();
        }
    }
}
