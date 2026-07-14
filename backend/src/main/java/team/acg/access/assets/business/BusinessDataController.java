package team.acg.access.assets.business;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.idanchuang.ecp.sdk.spring.annotation.PermissionSpec;
import com.idanchuang.ecp.sdk.spring.annotation.RequireAnyPermission;
import com.idanchuang.ecp.sdk.spring.annotation.RequirePermission;
import jakarta.servlet.http.HttpServletRequest;
import team.acg.access.assets.auth.RequestIdentityService;
import team.acg.access.assets.asset.AssetPartyResolver;
import team.acg.access.assets.asset.AssetService;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.LinkedHashMap;
import java.util.function.Function;
import java.util.Map;
import java.util.Set;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import org.springframework.transaction.annotation.Transactional;

@RestController
@RequestMapping("/api/business-data")
public class BusinessDataController {
    private static final int MAX_BUSINESS_ITEMS = 10_000;
    private static final int MAX_BUSINESS_SNAPSHOT_BYTES = 10 * 1024 * 1024;
    private static final int MAX_REQUEST_DETAILS_BYTES = 256 * 1024;
    private static final Set<String> EXECUTABLE_ASSET_REQUEST_TYPES = Set.of(
        "资产领用", "资产借用", "资产归还", "资产退还", "资产交接");
    private static final Set<String> TYPES = Set.of("requests", "stocktakes", "consumables", "repairs", "contracts");
    private static final Map<String, String> VIEW_PERMISSIONS = Map.of(
        "requests", "asset:request:view",
        "stocktakes", "asset:stocktake:view",
        "consumables", "asset:consumable:view",
        "repairs", "asset:repair:view",
        "contracts", "asset:contract:view");
    private final BusinessDataRepository repository;
    private final ObjectMapper mapper;
    private final RequestIdentityService identityService;
    private final SelfServiceRequestPolicy selfServiceRequestPolicy;
    private final AssetService assetService;
    private final AssetPartyResolver assetPartyResolver;

    public BusinessDataController(BusinessDataRepository repository, ObjectMapper mapper,
                                  RequestIdentityService identityService,
                                  SelfServiceRequestPolicy selfServiceRequestPolicy,
                                  AssetService assetService,
                                  AssetPartyResolver assetPartyResolver) {
        this.repository = repository;
        this.mapper = mapper;
        this.identityService = identityService;
        this.selfServiceRequestPolicy = selfServiceRequestPolicy;
        this.assetService = assetService;
        this.assetPartyResolver = assetPartyResolver;
    }

    @GetMapping
    @RequireAnyPermission({
        @PermissionSpec("asset:request:view"),
        @PermissionSpec("asset:stocktake:view"),
        @PermissionSpec("asset:consumable:view"),
        @PermissionSpec("asset:repair:view"),
        @PermissionSpec("asset:contract:view")
    })
    public Map<String, Object> list(HttpServletRequest request) {
        Map<String, JsonNode> values = new LinkedHashMap<>();
        Map<String, Long> versions = new LinkedHashMap<>();
        var identity = identityService.current(request);
        Set<String> visibleTypes = identity
            .map(value -> VIEW_PERMISSIONS.entrySet().stream()
                .filter(entry -> value.hasPermission(entry.getValue()))
                .map(Map.Entry::getKey)
                .collect(java.util.stream.Collectors.toUnmodifiableSet()))
            .orElse(TYPES);
        visibleTypes.forEach(type -> {
            values.put(type, mapper.createArrayNode());
            versions.put(type, 0L);
        });
        repository.findAll().forEach((type, snapshot) -> {
            if (visibleTypes.contains(type)) {
                JsonNode document = snapshot.document();
                if (identity.isPresent() && "requests".equals(type)
                    && !identity.get().manager()
                    && !"auditor".equals(identity.get().roleCode())) {
                    if (!document.isArray()) return;
                    ArrayNode scoped = mapper.createArrayNode();
                    document.forEach(item -> {
                        String applicantSubject = item.path("applicantSubject").asText();
                        boolean sameSubject = !identity.get().subject().isBlank()
                            && identity.get().subject().equals(applicantSubject);
                        if (sameSubject) scoped.add(item);
                    });
                    document = scoped;
                }
                values.put(type, document);
                versions.put(type, snapshot.version());
            }
        });
        return Map.of("values", values, "versions", versions);
    }

    @PostMapping("/requests")
    @RequirePermission(permissions = "asset:request:create")
    public ResponseEntity<?> createRequest(@RequestBody CreateRequest command, HttpServletRequest request) {
        requireText(command.type(), 64, "Request type is required");
        requireText(command.asset(), 4_000, "Request asset is required");
        requireOptionalText(command.reason(), 4_000, "Request reason is too long");
        validateRequestDetails(command.details());
        identityService.current(request).ifPresent(identity ->
            selfServiceRequestPolicy.enforce(command.type(), command.reason(), command.details(), identity));
        String applicant = identityService.trustedName(request, command.applicant());
        ObjectNode item = mapper.createObjectNode();
        item.put("id", id("REQ"));
        item.put("type", command.type().trim());
        item.put("applicant", applicant);
        identityService.current(request).ifPresent(identity -> {
            item.put("applicantSubject", identity.subject());
            item.put("applicantDirectorySubject", identity.directorySubject());
        });
        item.put("asset", command.asset().trim());
        item.put("reason", command.reason() == null ? "" : command.reason().trim());
        item.put("status", "审批中");
        item.put("system", "ECP审批");
        item.put("date", java.time.LocalDate.now().toString());
        item.put("currentNode", "直属主管");
        if (command.details() != null && command.details().isObject()) {
            Set.of("assetCount", "assetIds", "receiveLocation", "receiveDate", "borrowLocation", "borrowDate",
                    "returnLocation", "returnDate", "expectedReturnDate", "handoverLocation", "handoverDate",
                    "receiverSubject", "handoverType", "approvalDate")
                .forEach(field -> {
                    JsonNode value = command.details().get(field);
                    if (value != null) item.set(field, value);
                });
        }

        for (int attempt = 0; attempt < 3; attempt++) {
            BusinessDataRepository.Snapshot current = repository.find("requests").orElse(null);
            ArrayNode items = current == null || !current.document().isArray()
                ? mapper.createArrayNode() : (ArrayNode) current.document().deepCopy();
            if (items.size() >= MAX_BUSINESS_ITEMS) {
                throw new IllegalStateException("Business request storage has reached its item limit");
            }
            items.insert(0, item);
            validateSnapshot("requests", items);
            if (current == null) {
                try {
                    BusinessDataRepository.Snapshot created = repository.create("requests", items);
                    return ResponseEntity.status(HttpStatus.CREATED).body(Map.of("item", item, "version", created.version()));
                } catch (DuplicateKeyException ignored) {
                    continue;
                }
            }
            var updated = repository.update("requests", items, current.version());
            if (updated.isPresent()) return ResponseEntity.status(HttpStatus.CREATED).body(Map.of("item", item, "version", updated.get().version()));
        }
        return conflict("requests");
    }

    @PostMapping("/requests/{id}/decision")
    @RequirePermission(permissions = "asset:request:review")
    @Transactional
    public ResponseEntity<?> decideRequest(@PathVariable String id, @RequestBody RequestDecision command,
                                           HttpServletRequest request) {
        if (!Set.of("approve", "reject", "cancel").contains(command.decision())) throw new IllegalArgumentException("Unsupported request decision");
        String operator = identityService.trustedName(request, command.operator());
        if ("approve".equals(command.decision())) {
            BusinessDataRepository.Snapshot snapshot = repository.findForUpdate("requests")
                .orElseThrow(() -> new IllegalArgumentException("Business item not found: " + id));
            if (!snapshot.document().isArray()) throw new IllegalStateException("Business request snapshot is invalid");
            ArrayNode items = (ArrayNode) snapshot.document().deepCopy();
            ObjectNode target = findRequest(items, id);
            String current = target.path("status").asText();
            if (!Set.of("审批中", "待执行").contains(current)) {
                throw new IllegalArgumentException("Request is already finalized");
            }
            if (EXECUTABLE_ASSET_REQUEST_TYPES.contains(target.path("type").asText())) {
                executeApprovedAssetRequest(target, request);
                target.put("status", "已完成");
                target.put("currentNode", "已归档");
            } else {
                target.put("status", "待执行");
                target.put("currentNode", "普通管理员执行");
            }
            recordDecision(target, operator, command.reason(), request);
            BusinessDataRepository.Snapshot saved = repository.update("requests", items, snapshot.version())
                .orElseThrow(() -> new IllegalStateException("Business request changed while it was locked"));
            return ResponseEntity.ok(Map.of("items", saved.document(), "version", saved.version()));
        }
        return updateItem("requests", id, item -> {
            String current = item.path("status").asText();
            if (!Set.of("审批中", "待执行").contains(current)) throw new IllegalArgumentException("Request is already finalized");
            String status = "reject".equals(command.decision()) ? "已拒绝" : "已取消";
            item.put("status", status);
            item.put("currentNode", "已归档");
            recordDecision(item, operator, command.reason(), request);
            return item;
        });
    }

    private ObjectNode findRequest(ArrayNode items, String id) {
        for (JsonNode item : items) {
            if (item.isObject() && id.equals(item.path("id").asText())) return (ObjectNode) item;
        }
        throw new IllegalArgumentException("Business item not found: " + id);
    }

    private void executeApprovedAssetRequest(ObjectNode item, HttpServletRequest request) {
        String type = item.path("type").asText();
        String action = switch (type) {
            case "资产领用" -> "receive";
            case "资产借用" -> "borrow";
            case "资产归还" -> "borrow-return";
            case "资产退还" -> "return";
            case "资产交接" -> "handover";
            default -> throw new IllegalArgumentException("Unsupported executable request type: " + type);
        };
        ObjectNode fields = mapper.createObjectNode();
        List<String> assetIds = requestAssetIds(item);
        identityService.current(request).ifPresent(identity -> {
            fields.put("operator", identity.name());
            fields.put("operatorAccount", identity.account());
            fields.put("operatorSubject", identity.directorySubject());
        });
        fields.put("note", item.path("reason").asText(""));
        fields.put("company", item.path("company").asText(""));
        fields.put("department", item.path("department").asText(""));
        switch (action) {
            case "receive" -> {
                fields.put("receiver", item.path("applicant").asText());
                fields.put("receiverSubject", requiredRequestField(item, "applicantDirectorySubject"));
                fields.put("location", requiredRequestField(item, "receiveLocation"));
                fields.put("date", requestDate(item, "receiveDate"));
            }
            case "borrow" -> {
                fields.put("borrower", item.path("applicant").asText());
                fields.put("borrowerSubject", requiredRequestField(item, "applicantDirectorySubject"));
                fields.put("location", requiredRequestField(item, "borrowLocation"));
                fields.put("date", requestDate(item, "borrowDate"));
                fields.put("expectedReturnDate", requiredRequestField(item, "expectedReturnDate"));
            }
            case "borrow-return", "return" -> {
                assetService.requireOwnedForApprovedRequest(assetIds,
                    requiredRequestField(item, "applicantDirectorySubject"),
                    "borrow-return".equals(action) ? Set.of("借用中") : Set.of("在用"));
                fields.put("location", requiredRequestField(item, "returnLocation"));
                fields.put("date", requestDate(item, "returnDate"));
            }
            case "handover" -> {
                assetService.requireOwnedForApprovedRequest(assetIds,
                    requiredRequestField(item, "applicantDirectorySubject"), Set.of("在用", "借用中"));
                String handoverType = item.path("handoverType").asText("员工交接");
                if (!"公共交接".equals(handoverType)) {
                    fields.put("receiverSubject", requiredRequestField(item, "receiverSubject"));
                }
                fields.put("location", requiredRequestField(item, "handoverLocation"));
                fields.put("date", requestDate(item, "handoverDate"));
                fields.put("handoverType", handoverType);
            }
            default -> throw new IllegalStateException("Unsupported asset action: " + action);
        }
        assetPartyResolver.normalizeCommand(action, fields);
        assetService.execute(action, assetIds, fields);
    }

    private List<String> requestAssetIds(JsonNode item) {
        JsonNode values = item.path("assetIds");
        if (!values.isArray() || values.isEmpty() || values.size() > 100) {
            throw new IllegalArgumentException("Executable request must contain between 1 and 100 asset ids");
        }
        List<String> ids = new ArrayList<>();
        values.forEach(value -> {
            String id = value.asText("").trim();
            if (id.isEmpty() || ids.contains(id)) throw new IllegalArgumentException("Executable request contains invalid asset ids");
            ids.add(id);
        });
        return List.copyOf(ids);
    }

    private String requiredRequestField(JsonNode item, String field) {
        String value = item.path(field).asText("").trim();
        if (value.isEmpty()) throw new IllegalArgumentException("Executable request field is required: " + field);
        return value;
    }

    private String requestDate(JsonNode item, String field) {
        String value = item.path(field).asText("").trim();
        return value.isEmpty() ? java.time.LocalDate.now().toString() : java.time.LocalDate.parse(value).toString();
    }

    private void recordDecision(ObjectNode item, String operator, String reason, HttpServletRequest request) {
        item.put("decisionOperator", operator);
        identityService.current(request).ifPresent(identity -> item.put("decisionOperatorSubject", identity.subject()));
        item.put("decisionReason", reason == null ? "" : reason.trim());
        item.put("decisionAt", java.time.Instant.now().toString());
    }

    @PostMapping("/stocktakes")
    @RequirePermission(permissions = "asset:stocktake:create")
    public ResponseEntity<?> createStocktake(@RequestBody CreateStocktake command) {
        requireText(command.name(), "Stocktake name is required");
        requireText(command.scope(), "Stocktake scope is required");
        requireText(command.owner(), "Stocktake owner is required");
        if (command.total() <= 0) throw new IllegalArgumentException("Stocktake total must be positive");
        ObjectNode item = mapper.createObjectNode();
        item.put("id", id("STK"));
        item.put("name", command.name().trim());
        item.put("scope", command.scope().trim());
        item.put("owner", command.owner().trim());
        item.put("progress", "未开始");
        item.put("total", command.total());
        item.put("checked", 0);
        item.put("diff", 0);
        item.put("date", command.date() == null || command.date().isBlank() ? java.time.LocalDate.now().toString() : command.date().trim());
        return append("stocktakes", item);
    }

    @PatchMapping("/stocktakes/{id}")
    @RequirePermission(permissions = "asset:stocktake:update")
    public ResponseEntity<?> updateStocktake(@PathVariable String id, @RequestBody UpdateStocktake command) {
        return updateItem("stocktakes", id, item -> {
            int total = item.path("total").asInt();
            int checked = command.checked() == null ? item.path("checked").asInt() : command.checked();
            int diff = command.diff() == null ? item.path("diff").asInt() : command.diff();
            if (checked < 0 || checked > total) throw new IllegalArgumentException("Checked count must be between zero and total");
            if (diff < 0 || diff > checked) throw new IllegalArgumentException("Difference count must be between zero and checked");
            item.put("checked", checked);
            item.put("diff", diff);
            item.put("progress", checked == 0 ? "未开始" : checked == total ? "已完成" : "盘点中");
            return item;
        });
    }

    @PostMapping("/consumables")
    @RequirePermission(permissions = "asset:consumable:create")
    public ResponseEntity<?> createConsumable(@RequestBody CreateConsumable command) {
        requireText(command.name(), "Consumable name is required");
        requireText(command.model(), "Consumable model is required");
        requireText(command.warehouse(), "Consumable warehouse is required");
        if (command.quantity() < 0 || command.minimum() < 0) throw new IllegalArgumentException("Consumable quantities cannot be negative");
        ObjectNode item = mapper.createObjectNode();
        item.put("id", id("CON"));
        item.put("name", command.name().trim());
        item.put("model", command.model().trim());
        item.put("stock", command.quantity());
        item.put("min", command.minimum());
        item.put("warehouse", command.warehouse().trim());
        return append("consumables", item);
    }

    @PostMapping("/consumables/{id}/adjust")
    @RequirePermission(permissions = "asset:consumable:adjust")
    public ResponseEntity<?> adjustConsumable(@PathVariable String id, @RequestBody AdjustStock command) {
        if (command.quantity() == 0) throw new IllegalArgumentException("Adjustment quantity cannot be zero");
        requireText(command.reason(), "Adjustment reason is required");
        return updateItem("consumables", id, item -> {
            int stock = item.path("stock").asInt() + command.quantity();
            if (stock < 0) throw new IllegalArgumentException("Consumable stock cannot be negative");
            item.put("stock", stock);
            item.put("lastReason", command.reason().trim());
            item.put("updatedAt", java.time.Instant.now().toString());
            return item;
        });
    }

    @PostMapping("/repairs")
    @RequirePermission(permissions = "asset:repair:create")
    @Transactional
    public ResponseEntity<?> createRepair(@RequestBody CreateRepair command, HttpServletRequest request) {
        requireText(command.asset(), "Repair asset is required");
        requireText(command.description(), "Repair description is required");
        String assetId = command.asset().trim();
        identityService.current(request).ifPresent(identity -> {
            if (assetService.findAccessibleByIds(identity, List.of(assetId)).isEmpty()) {
                throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Repair asset is not accessible");
            }
        });
        ObjectNode fields = commandFields(request);
        fields.put("date", java.time.LocalDate.now().toString());
        fields.put("note", command.description().trim());
        List<JsonNode> repairedAssets = assetService.execute("repair-start", List.of(assetId), fields);
        ObjectNode item = mapper.createObjectNode();
        item.put("id", id("RPR"));
        item.put("asset", assetId);
        item.put("assetName", repairedAssets.isEmpty() ? "" : repairedAssets.get(0).path("name").asText(""));
        item.put("description", command.description().trim());
        item.put("reporter", identityService.trustedName(request, command.reporter()));
        identityService.current(request).ifPresent(identity -> item.put("reporterSubject", identity.subject()));
        item.put("status", "维修中");
        item.put("handler", "-");
        item.put("previousAssetStatus", repairedAssets.isEmpty() ? "" : repairedAssets.get(0).path("repairPreviousStatus").asText(""));
        item.put("date", java.time.LocalDate.now().toString());
        return append("repairs", item);
    }

    @PatchMapping("/repairs/{id}")
    @RequirePermission(permissions = "asset:repair:update")
    @Transactional
    public ResponseEntity<?> updateRepair(@PathVariable String id, @RequestBody UpdateRepair command,
                                          HttpServletRequest request) {
        Set<String> statuses = Set.of("待处理", "维修中", "已完成", "已取消");
        if (!statuses.contains(command.status())) throw new IllegalArgumentException("Unsupported repair status");
        return updateItem("repairs", id, item -> {
            String beforeStatus = item.path("status").asText();
            if (Set.of("已完成", "已取消").contains(command.status())
                && !Set.of("已完成", "已取消").contains(beforeStatus)) {
                ObjectNode fields = commandFields(request);
                fields.put("date", java.time.LocalDate.now().toString());
                fields.put("restoreStatus", item.path("previousAssetStatus").asText("空闲"));
                fields.put("note", "维修单" + command.status());
                assetService.execute("repair-complete", List.of(item.path("asset").asText()), fields);
            }
            item.put("status", command.status());
            if (command.handler() != null && !command.handler().isBlank()) item.put("handler", command.handler().trim());
            item.put("updatedAt", java.time.Instant.now().toString());
            return item;
        });
    }

    @PostMapping("/contracts")
    @RequirePermission(permissions = "asset:contract:create")
    public ResponseEntity<?> createContract(@RequestBody CreateContract command) {
        requireText(command.supplier(), "Contract supplier is required");
        requireText(command.name(), "Contract name is required");
        requireText(command.endDate(), "Contract end date is required");
        ObjectNode item = mapper.createObjectNode();
        item.put("id", id("CTR"));
        item.put("supplier", command.supplier().trim());
        item.put("name", command.name().trim());
        item.put("endDate", command.endDate().trim());
        item.put("amount", Math.max(0, command.amount()));
        item.put("status", "在用");
        return append("contracts", item);
    }

    private ResponseEntity<?> append(String type, ObjectNode item) {
        return mutate(type, items -> items.insert(0, item), item);
    }

    private ObjectNode commandFields(HttpServletRequest request) {
        ObjectNode fields = mapper.createObjectNode();
        identityService.current(request).ifPresent(identity -> {
            fields.put("operator", identity.name());
            fields.put("operatorAccount", identity.account());
            fields.put("operatorSubject", identity.directorySubject());
        });
        if (!fields.has("operator")) fields.put("operator", identityService.trustedName(request, "系统"));
        return fields;
    }

    private ResponseEntity<?> updateItem(String type, String id, Function<ObjectNode, ObjectNode> change) {
        return mutate(type, items -> {
            for (int index = 0; index < items.size(); index++) {
                JsonNode candidate = items.get(index);
                if (candidate.isObject() && id.equals(candidate.path("id").asText())) {
                    items.set(index, change.apply((ObjectNode) candidate));
                    return items;
                }
            }
            throw new IllegalArgumentException("Business item not found: " + id);
        }, null);
    }

    private ResponseEntity<?> mutate(String type, Function<ArrayNode, ArrayNode> mutation, ObjectNode createdItem) {
        for (int attempt = 0; attempt < 3; attempt++) {
            BusinessDataRepository.Snapshot current = repository.find(type).orElse(null);
            ArrayNode items = current == null || !current.document().isArray() ? mapper.createArrayNode() : (ArrayNode) current.document().deepCopy();
            mutation.apply(items);
            validateSnapshot(type, items);
            try {
                BusinessDataRepository.Snapshot saved = current == null ? repository.create(type, items) : repository.update(type, items, current.version()).orElse(null);
                if (saved != null) {
                    Map<String, Object> body = new LinkedHashMap<>();
                    if (createdItem != null) body.put("item", createdItem);
                    else body.put("items", saved.document());
                    body.put("version", saved.version());
                    return ResponseEntity.status(createdItem == null ? HttpStatus.OK : HttpStatus.CREATED).body(body);
                }
            } catch (DuplicateKeyException ignored) {
                // Retry an optimistic create race.
            }
        }
        return conflict(type);
    }

    private String id(String prefix) {
        return prefix + "-" + java.util.UUID.randomUUID();
    }

    private void requireText(String value, String message) {
        requireText(value, 4_000, message);
    }

    private void requireText(String value, int maxLength, String message) {
        if (value == null || value.isBlank() || value.trim().length() > maxLength) {
            throw new IllegalArgumentException(message);
        }
    }

    private void requireOptionalText(String value, int maxLength, String message) {
        if (value != null && value.trim().length() > maxLength) throw new IllegalArgumentException(message);
    }

    private void validateRequestDetails(JsonNode details) {
        if (details == null || details.isNull()) return;
        if (!details.isObject()) throw new IllegalArgumentException("Request details must be an object");
        if (details.toString().getBytes(StandardCharsets.UTF_8).length > MAX_REQUEST_DETAILS_BYTES) {
            throw new IllegalArgumentException("Request details are too large");
        }
    }

    private void validateSnapshot(String type, ArrayNode items) {
        if (items.size() > MAX_BUSINESS_ITEMS) {
            throw new IllegalStateException("Business data item limit exceeded: " + type);
        }
        if (items.toString().getBytes(StandardCharsets.UTF_8).length > MAX_BUSINESS_SNAPSHOT_BYTES) {
            throw new IllegalStateException("Business data snapshot is too large: " + type);
        }
    }

    private ResponseEntity<?> conflict(String type) {
        long version = repository.find(type).map(BusinessDataRepository.Snapshot::version).orElse(0L);
        return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("error", "Business data version conflict", "type", type, "version", version));
    }

    public record CreateRequest(String type, String applicant, String asset, String reason, JsonNode details) {}
    public record RequestDecision(String decision, String operator, String reason) {}
    public record CreateStocktake(String name, String scope, String owner, int total, String date) {}
    public record UpdateStocktake(Integer checked, Integer diff) {}
    public record CreateConsumable(String name, String model, int quantity, int minimum, String warehouse) {}
    public record AdjustStock(int quantity, String reason) {}
    public record CreateRepair(String asset, String description, String reporter) {}
    public record UpdateRepair(String status, String handler) {}
    public record CreateContract(String supplier, String name, String endDate, double amount) {}
}
