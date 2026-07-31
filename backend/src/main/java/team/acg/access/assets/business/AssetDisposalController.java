package team.acg.access.assets.business;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.idanchuang.ecp.sdk.spring.annotation.RequirePermission;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import team.acg.access.assets.asset.AssetService;
import team.acg.access.assets.auth.RequestIdentityService;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;

@RestController
@RequestMapping("/api/asset-disposals")
public class AssetDisposalController {
    private static final String SNAPSHOT_TYPE = "disposals";
    private static final int MAX_ASSETS_PER_ORDER = 500;
    private static final Set<String> DISPOSAL_TYPES = Set.of("退租", "报废", "捐赠", "其他");
    private static final DateTimeFormatter ORDER_TIME = DateTimeFormatter.ofPattern("yyyyMMddHHmmssSSS");

    private final BusinessDataRepository repository;
    private final AssetService assetService;
    private final RequestIdentityService identityService;
    private final ObjectMapper mapper;

    public AssetDisposalController(BusinessDataRepository repository, AssetService assetService,
                                   RequestIdentityService identityService, ObjectMapper mapper) {
        this.repository = repository;
        this.assetService = assetService;
        this.identityService = identityService;
        this.mapper = mapper;
    }

    @GetMapping
    @RequirePermission(permissions = "asset:disposal:view")
    public Map<String, Object> list() {
        BusinessDataRepository.Snapshot snapshot = repository.find(SNAPSHOT_TYPE).orElse(null);
        return Map.of(
            "items", snapshot == null ? mapper.createArrayNode() : snapshot.document(),
            "version", snapshot == null ? 0L : snapshot.version());
    }

    @PostMapping
    @RequirePermission(permissions = "asset:disposal:create")
    @Transactional
    public ResponseEntity<?> create(@RequestBody CreateDisposal command, HttpServletRequest request) {
        String disposalType = text(command.disposalType());
        if (!DISPOSAL_TYPES.contains(disposalType)) throw new IllegalArgumentException("Unsupported disposal type");
        String description = text(command.description());
        if (description.isEmpty() || description.length() > 4_000) {
            throw new IllegalArgumentException("Disposal description is required and must not exceed 4000 characters");
        }
        List<String> assetIds = normalizedIds(command.assetIds());
        if (assetIds.isEmpty() || assetIds.size() > MAX_ASSETS_PER_ORDER) {
            throw new IllegalArgumentException("Disposal order requires between 1 and 500 assets");
        }

        List<JsonNode> visibleAssets = identityService.current(request)
            .map(identity -> assetService.findAccessibleByIds(identity, assetIds))
            .orElseGet(assetService::list);
        Map<String, JsonNode> byId = new LinkedHashMap<>();
        visibleAssets.forEach(asset -> {
            if (assetIds.contains(asset.path("id").asText())) byId.put(asset.path("id").asText(), asset);
        });
        if (byId.size() != assetIds.size()) throw new IllegalArgumentException("One or more disposal assets are unavailable");
        byId.values().forEach(asset -> {
            if (!"空闲".equals(asset.path("status").asText())) {
                throw new IllegalArgumentException("Only available assets can be disposed: " + asset.path("id").asText());
            }
        });

        String id = "CZ" + LocalDateTime.now().format(ORDER_TIME);
        String operator = identityService.trustedName(request, command.operator());
        ObjectNode fields = actorFields(request, operator);
        fields.put("date", LocalDate.now().toString());
        fields.put("disposalId", id);
        assetService.execute("disposal-start", assetIds, fields);

        ObjectNode item = mapper.createObjectNode();
        item.put("id", id);
        item.put("status", "待处置");
        item.put("disposalType", disposalType);
        item.put("company", text(command.company()).isEmpty() ? companyOf(byId.values()) : text(command.company()));
        item.put("operator", operator);
        item.put("amount", nonNegative(command.amount(), "Disposal amount cannot be negative"));
        item.put("fee", nonNegative(command.fee(), "Disposal fee cannot be negative"));
        item.put("description", description);
        item.put("createdAt", java.time.Instant.now().toString());
        item.put("createdDate", LocalDate.now().toString());
        if (!text(command.returnDate()).isEmpty()) item.put("returnDate", text(command.returnDate()));

        ArrayNode lines = mapper.createArrayNode();
        assetIds.forEach(assetId -> {
            JsonNode asset = byId.get(assetId);
            ObjectNode line = asset.deepCopy();
            line.put("assetId", assetId);
            line.put("status", "待处置");
            line.put("previousStatus", asset.path("status").asText("空闲"));
            lines.add(line);
        });
        item.set("assets", lines);
        item.put("assetCount", lines.size());

        BusinessDataRepository.Snapshot saved = prepend(item);
        return ResponseEntity.status(HttpStatus.CREATED).body(Map.of(
            "item", item, "version", saved.version()));
    }

    @PatchMapping("/{id}/complete")
    @RequirePermission(permissions = "asset:disposal:complete")
    @Transactional
    public ResponseEntity<?> complete(@PathVariable String id, HttpServletRequest request) {
        ObjectNode item = requireItem(id);
        List<String> assetIds = lineIds(item, Set.of("待处置"));
        if (assetIds.isEmpty()) throw new IllegalArgumentException("Disposal order has no pending assets");
        ObjectNode fields = actorFields(request, "系统");
        fields.put("date", LocalDate.now().toString());
        fields.put("disposalId", id);
        assetService.execute("disposal-complete", assetIds, fields);
        updateLines(item, new HashSet<>(assetIds), "已处置");
        item.put("status", deriveStatus(item));
        item.put("completedAt", java.time.Instant.now().toString());
        return ok(updateStored(item));
    }

    @PostMapping("/{id}/cancel")
    @RequirePermission(permissions = "asset:disposal:cancel")
    @Transactional
    public ResponseEntity<?> cancel(@PathVariable String id, @RequestBody(required = false) CancelDisposal command,
                                    HttpServletRequest request) {
        ObjectNode item = requireItem(id);
        Set<String> cancellable = new LinkedHashSet<>(lineIds(item, Set.of("待处置", "已处置")));
        List<String> requested = command == null || command.assetIds() == null || command.assetIds().isEmpty()
            ? new ArrayList<>(cancellable) : normalizedIds(command.assetIds());
        if (requested.isEmpty() || !cancellable.containsAll(requested)) {
            throw new IllegalArgumentException("One or more disposal assets cannot be cancelled");
        }
        ObjectNode fields = actorFields(request, "系统");
        fields.put("date", LocalDate.now().toString());
        fields.put("disposalId", id);
        fields.put("reason", command == null ? "" : text(command.reason()));
        assetService.execute("disposal-cancel", requested, fields);
        updateLines(item, new HashSet<>(requested), "已取消");
        item.put("status", deriveStatus(item));
        item.put("updatedAt", java.time.Instant.now().toString());
        return ok(updateStored(item));
    }

    private BusinessDataRepository.Snapshot prepend(ObjectNode item) {
        BusinessDataRepository.Snapshot current = repository.find(SNAPSHOT_TYPE).orElse(null);
        ArrayNode items = current == null || !current.document().isArray()
            ? mapper.createArrayNode() : (ArrayNode) current.document().deepCopy();
        items.insert(0, item);
        if (items.size() > 10_000) throw new IllegalStateException("Disposal storage has reached its item limit");
        if (current == null) return repository.create(SNAPSHOT_TYPE, items);
        return repository.update(SNAPSHOT_TYPE, items, current.version())
            .orElseThrow(() -> new IllegalStateException("Disposal data version conflict"));
    }

    private BusinessDataRepository.Snapshot updateStored(ObjectNode updated) {
        BusinessDataRepository.Snapshot current = repository.find(SNAPSHOT_TYPE)
            .orElseThrow(() -> new IllegalArgumentException("Disposal order not found: " + updated.path("id").asText()));
        ArrayNode items = (ArrayNode) current.document().deepCopy();
        for (int index = 0; index < items.size(); index++) {
            if (updated.path("id").asText().equals(items.path(index).path("id").asText())) {
                items.set(index, updated);
                return repository.update(SNAPSHOT_TYPE, items, current.version())
                    .orElseThrow(() -> new IllegalStateException("Disposal data version conflict"));
            }
        }
        throw new IllegalArgumentException("Disposal order not found: " + updated.path("id").asText());
    }

    private ObjectNode requireItem(String id) {
        JsonNode document = repository.find(SNAPSHOT_TYPE)
            .map(BusinessDataRepository.Snapshot::document).orElse(mapper.createArrayNode());
        for (JsonNode candidate : document) {
            if (id.equals(candidate.path("id").asText()) && candidate.isObject()) return (ObjectNode) candidate.deepCopy();
        }
        throw new IllegalArgumentException("Disposal order not found: " + id);
    }

    private ResponseEntity<?> ok(BusinessDataRepository.Snapshot saved) {
        return ResponseEntity.ok(Map.of("items", saved.document(), "version", saved.version()));
    }

    private ObjectNode actorFields(HttpServletRequest request, String fallback) {
        ObjectNode fields = mapper.createObjectNode();
        identityService.current(request).ifPresent(identity -> {
            fields.put("operator", identity.name());
            fields.put("operatorAccount", identity.account());
            fields.put("operatorSubject", identity.directorySubject());
        });
        if (!fields.has("operator")) fields.put("operator", identityService.trustedName(request, fallback));
        return fields;
    }

    private List<String> normalizedIds(List<String> values) {
        if (values == null) return List.of();
        LinkedHashSet<String> ids = new LinkedHashSet<>();
        values.forEach(value -> {
            String id = text(value);
            if (!id.isEmpty()) ids.add(id);
        });
        if (ids.size() != values.size()) throw new IllegalArgumentException("Asset ids must be unique and non-empty");
        return new ArrayList<>(ids);
    }

    private List<String> lineIds(ObjectNode item, Set<String> statuses) {
        List<String> ids = new ArrayList<>();
        item.path("assets").forEach(line -> {
            if (statuses.contains(line.path("status").asText())) ids.add(line.path("assetId").asText());
        });
        return ids;
    }

    private void updateLines(ObjectNode item, Set<String> assetIds, String status) {
        item.withArray("assets").forEach(line -> {
            if (assetIds.contains(line.path("assetId").asText()) && line.isObject()) {
                ((ObjectNode) line).put("status", status);
            }
        });
    }

    private String deriveStatus(ObjectNode item) {
        Set<String> statuses = new HashSet<>();
        item.path("assets").forEach(line -> statuses.add(line.path("status").asText()));
        if (statuses.equals(Set.of("已取消"))) return "已取消";
        if (statuses.equals(Set.of("已处置"))) return "已处置";
        if (statuses.contains("已取消")) return "部分取消";
        return "待处置";
    }

    private String companyOf(Collection<JsonNode> assets) {
        return assets.stream().map(asset -> asset.path("ownerCompany").asText(asset.path("company").asText("")))
            .filter(value -> !value.isBlank()).findFirst().orElse("");
    }

    private double nonNegative(Double value, String message) {
        double normalized = value == null ? 0 : value;
        if (!Double.isFinite(normalized) || normalized < 0) throw new IllegalArgumentException(message);
        return normalized;
    }

    private String text(String value) {
        return value == null ? "" : value.trim();
    }

    public record CreateDisposal(String disposalType, String company, String operator, Double amount, Double fee,
                                 String description, String returnDate, List<String> assetIds) {}
    public record CancelDisposal(List<String> assetIds, String reason) {}
}
