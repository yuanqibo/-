package team.acg.access.assets.business;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.idanchuang.ecp.sdk.spring.annotation.RequirePermission;
import jakarta.servlet.http.HttpServletRequest;
import team.acg.access.assets.auth.RequestIdentityService;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.function.Function;
import java.util.Map;
import java.util.Set;

@RestController
@RequestMapping("/api/business-data")
public class BusinessDataController {
    private static final Set<String> TYPES = Set.of("requests", "stocktakes", "consumables", "repairs", "contracts");
    private final BusinessDataRepository repository;
    private final ObjectMapper mapper;
    private final RequestIdentityService identityService;

    public BusinessDataController(BusinessDataRepository repository, ObjectMapper mapper,
                                  RequestIdentityService identityService) {
        this.repository = repository;
        this.mapper = mapper;
        this.identityService = identityService;
    }

    @GetMapping
    @RequirePermission(permissions = "request:view")
    public Map<String, Object> list(HttpServletRequest request) {
        Map<String, JsonNode> values = new LinkedHashMap<>();
        Map<String, Long> versions = new LinkedHashMap<>();
        var identity = identityService.current(request);
        Set<String> visibleTypes = identity.isPresent() && !identity.get().manager() ? Set.of("requests") : TYPES;
        visibleTypes.forEach(type -> {
            values.put(type, mapper.createArrayNode());
            versions.put(type, 0L);
        });
        repository.findAll().forEach((type, snapshot) -> {
            if (visibleTypes.contains(type)) {
                JsonNode document = snapshot.document();
                if (identity.isPresent() && !identity.get().manager()) {
                    if (!"requests".equals(type) || !document.isArray()) return;
                    ArrayNode scoped = mapper.createArrayNode();
                    document.forEach(item -> {
                        if (identity.get().name().equals(item.path("applicant").asText())) scoped.add(item);
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
    @RequirePermission(permissions = "request:view")
    public ResponseEntity<?> createRequest(@RequestBody CreateRequest command, HttpServletRequest request) {
        if (command.type() == null || command.type().isBlank()) throw new IllegalArgumentException("Request type is required");
        if (command.asset() == null || command.asset().isBlank()) throw new IllegalArgumentException("Request asset is required");
        String applicant = identityService.trustedName(request, command.applicant());
        ObjectNode item = mapper.createObjectNode();
        item.put("id", "REQ" + java.time.format.DateTimeFormatter.ofPattern("yyMMddHHmmssSSS").format(java.time.LocalDateTime.now()));
        item.put("type", command.type().trim());
        item.put("applicant", applicant);
        item.put("asset", command.asset().trim());
        item.put("reason", command.reason() == null ? "" : command.reason().trim());
        item.put("status", "审批中");
        item.put("system", "ECP审批");
        item.put("date", java.time.LocalDate.now().toString());
        item.put("currentNode", "直属主管");
        if (command.details() != null && command.details().isObject()) {
            Set.of("assetCount", "assetIds", "operator", "receiveLocation", "borrowLocation", "expectedReturnDate", "approvalDate")
                .forEach(field -> {
                    JsonNode value = command.details().get(field);
                    if (value != null) item.set(field, value);
                });
        }

        for (int attempt = 0; attempt < 3; attempt++) {
            BusinessDataRepository.Snapshot current = repository.find("requests").orElse(null);
            ArrayNode items = current == null || !current.document().isArray()
                ? mapper.createArrayNode() : (ArrayNode) current.document().deepCopy();
            items.insert(0, item);
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
    @RequirePermission(permissions = "request:review")
    public ResponseEntity<?> decideRequest(@PathVariable String id, @RequestBody RequestDecision command,
                                           HttpServletRequest request) {
        if (!Set.of("approve", "reject", "cancel").contains(command.decision())) throw new IllegalArgumentException("Unsupported request decision");
        String operator = identityService.trustedName(request, command.operator());
        return updateItem("requests", id, item -> {
            String current = item.path("status").asText();
            if (!Set.of("审批中", "待执行").contains(current)) throw new IllegalArgumentException("Request is already finalized");
            String status = switch (command.decision()) {
                case "approve" -> "待执行";
                case "reject" -> "已拒绝";
                default -> "已取消";
            };
            item.put("status", status);
            item.put("currentNode", "approve".equals(command.decision()) ? "普通管理员执行" : "已归档");
            item.put("decisionOperator", operator);
            item.put("decisionReason", command.reason() == null ? "" : command.reason().trim());
            item.put("decisionAt", java.time.Instant.now().toString());
            return item;
        });
    }

    @PostMapping("/stocktakes")
    @RequirePermission(permissions = "stocktake:create")
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
    @RequirePermission(permissions = "stocktake:create")
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
    @RequirePermission(permissions = "asset:update")
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
    @RequirePermission(permissions = "asset:update")
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
    @RequirePermission(permissions = "asset:update")
    public ResponseEntity<?> createRepair(@RequestBody CreateRepair command, HttpServletRequest request) {
        requireText(command.asset(), "Repair asset is required");
        requireText(command.description(), "Repair description is required");
        ObjectNode item = mapper.createObjectNode();
        item.put("id", id("RPR"));
        item.put("asset", command.asset().trim());
        item.put("description", command.description().trim());
        item.put("reporter", identityService.trustedName(request, command.reporter()));
        item.put("status", "待处理");
        item.put("handler", "-");
        item.put("date", java.time.LocalDate.now().toString());
        return append("repairs", item);
    }

    @PatchMapping("/repairs/{id}")
    @RequirePermission(permissions = "asset:update")
    public ResponseEntity<?> updateRepair(@PathVariable String id, @RequestBody UpdateRepair command) {
        Set<String> statuses = Set.of("待处理", "维修中", "已完成", "已取消");
        if (!statuses.contains(command.status())) throw new IllegalArgumentException("Unsupported repair status");
        return updateItem("repairs", id, item -> {
            item.put("status", command.status());
            if (command.handler() != null && !command.handler().isBlank()) item.put("handler", command.handler().trim());
            item.put("updatedAt", java.time.Instant.now().toString());
            return item;
        });
    }

    @PostMapping("/contracts")
    @RequirePermission(permissions = "asset:update")
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
        return prefix + java.time.format.DateTimeFormatter.ofPattern("yyMMddHHmmssSSS").format(java.time.LocalDateTime.now());
    }

    private void requireText(String value, String message) {
        if (value == null || value.isBlank()) throw new IllegalArgumentException(message);
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
