package team.acg.access.assets.business;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.idanchuang.ecp.sdk.spring.annotation.PermissionSpec;
import com.idanchuang.ecp.sdk.spring.annotation.RequireAnyPermission;
import com.idanchuang.ecp.sdk.spring.annotation.RequirePermission;
import jakarta.servlet.http.HttpServletRequest;
import team.acg.access.assets.approval.ApprovalIntegrationService;
import team.acg.access.assets.approval.ApprovalRequestRepository;
import team.acg.access.assets.approval.ApprovalRequestStateService;
import team.acg.access.assets.approval.ApprovedAssetRequestExecutor;
import team.acg.access.assets.auth.RequestIdentityService;
import team.acg.access.assets.asset.AssetService;
import team.acg.access.assets.store.PortalReferenceCatalog;
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
import java.util.List;
import org.springframework.transaction.annotation.Transactional;

@RestController
@RequestMapping("/api/business-data")
public class BusinessDataController {
    private static final int MAX_BUSINESS_ITEMS = 10_000;
    private static final int MAX_BUSINESS_SNAPSHOT_BYTES = 10 * 1024 * 1024;
    private static final int MAX_REQUEST_DETAILS_BYTES = 256 * 1024;
    private static final Set<String> TYPES = Set.of("requests", "stocktakes", "consumables", "repairs", "contracts");
    private static final Set<String> EMPLOYEE_SELF_SERVICE_TYPES = Set.of(
        "资产领用", "资产借用", "资产归还", "资产退还", "资产交接");
    private static final Map<String, String> VIEW_PERMISSIONS = Map.of(
        "requests", "asset:request:view",
        "stocktakes", "asset:stocktake:view",
        "consumables", "asset:consumable:view",
        "repairs", "asset:repair:view",
        "contracts", "asset:contract:view");
    private static final Map<String, String> REQUEST_LOCATION_FIELDS = Map.of(
        "资产领用", "receiveLocation",
        "资产借用", "borrowLocation",
        "资产归还", "returnLocation",
        "资产退还", "returnLocation",
        "资产交接", "handoverLocation");
    private final BusinessDataRepository repository;
    private final ApprovalRequestRepository approvalRequests;
    private final ObjectMapper mapper;
    private final RequestIdentityService identityService;
    private final SelfServiceRequestPolicy selfServiceRequestPolicy;
    private final AssetService assetService;
    private final ApprovalIntegrationService approvalIntegration;
    private final ApprovalRequestStateService approvalState;
    private final ApprovedAssetRequestExecutor requestExecutor;
    private final PortalReferenceCatalog referenceCatalog;

    public BusinessDataController(BusinessDataRepository repository, ApprovalRequestRepository approvalRequests,
                                  ObjectMapper mapper,
                                  RequestIdentityService identityService,
                                  SelfServiceRequestPolicy selfServiceRequestPolicy,
                                  AssetService assetService,
                                  ApprovalIntegrationService approvalIntegration,
                                  ApprovalRequestStateService approvalState,
                                  ApprovedAssetRequestExecutor requestExecutor,
                                  PortalReferenceCatalog referenceCatalog) {
        this.repository = repository;
        this.approvalRequests = approvalRequests;
        this.mapper = mapper;
        this.identityService = identityService;
        this.selfServiceRequestPolicy = selfServiceRequestPolicy;
        this.assetService = assetService;
        this.approvalIntegration = approvalIntegration;
        this.approvalState = approvalState;
        this.requestExecutor = requestExecutor;
        this.referenceCatalog = referenceCatalog;
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
            if (visibleTypes.contains(type) && !"requests".equals(type)) {
                JsonNode document = snapshot.document();
                values.put(type, document);
                versions.put(type, snapshot.version());
            }
        });
        if (visibleTypes.contains("requests")) {
            ArrayNode requests = mapper.createArrayNode();
            approvalRequests.findAll().forEach(item -> {
                boolean scopedEmployee = identity.isPresent() && !identity.get().manager()
                    && !"auditor".equals(identity.get().roleCode());
                boolean sameSubject = identity.isPresent() && !identity.get().subject().isBlank()
                    && identity.get().subject().equals(item.path("applicantSubject").asText());
                if (!scopedEmployee || sameSubject) requests.add(item);
            });
            values.put("requests", requests);
            versions.put("requests", approvalRequests.revision());
        }
        return Map.of("values", values, "versions", versions);
    }

    @PostMapping("/requests")
    @RequirePermission(permissions = "asset:request:create")
    @Transactional
    public ResponseEntity<?> createRequest(@RequestBody CreateRequest command, HttpServletRequest request) {
        requireText(command.type(), 64, "Request type is required");
        requireText(command.asset(), 4_000, "Request asset is required");
        requireOptionalText(command.reason(), 4_000, "Request reason is too long");
        validateRequestDetails(command.details());
        validateRequestLocation(command.type(), command.details());
        var identity = identityService.current(request);
        identity.ifPresent(value ->
            selfServiceRequestPolicy.enforce(command.type(), command.reason(), command.details(), value));
        boolean immediateSelfService = identity
            .filter(value -> !value.manager() && EMPLOYEE_SELF_SERVICE_TYPES.contains(command.type().trim()))
            .map(value -> !selfServiceRequestPolicy.requiresApproval(command.type(), value))
            .orElse(false);
        String applicant = identityService.trustedName(request, command.applicant());
        ObjectNode item = mapper.createObjectNode();
        item.put("id", id("REQ"));
        item.put("type", command.type().trim());
        item.put("applicant", applicant);
        identity.ifPresent(value -> {
            item.put("applicantSubject", value.subject());
            item.put("applicantDirectorySubject", value.directorySubject());
            item.put("department", value.department());
        });
        item.put("asset", command.asset().trim());
        item.put("reason", command.reason() == null ? "" : command.reason().trim());
        boolean selfServiceRequest = identity
            .map(value -> !value.manager() && EMPLOYEE_SELF_SERVICE_TYPES.contains(command.type().trim()))
            .orElse(false);
        item.put("selfServiceRequest", selfServiceRequest);
        if (selfServiceRequest) item.put("operator", applicant);
        item.put("status", selfServiceRequest ? "待审批" : "审批中");
        item.put("system", selfServiceRequest ? "资产管理员审批" : "ECP审批");
        item.put("date", java.time.LocalDate.now().toString());
        item.put("currentNode", selfServiceRequest ? "管理员审批" : "直属主管");
        if (command.details() != null && command.details().isObject()) {
            Set.of("assetCount", "assetIds", "receiveType", "receiveLocation", "receiveDate", "borrowLocation", "borrowDate",
                    "returnLocation", "returnDate", "expectedReturnDate", "handoverLocation", "handoverDate",
                    "receiverSubject", "receiverName", "receiverCompany", "receiverDepartment",
                    "handoverType", "approvalDate", "signatureImage", "signatureNotice")
                .forEach(field -> {
                    JsonNode value = command.details().get(field);
                    if (value != null) item.set(field, value);
                });
        }
        item.put("bizNo", item.path("id").asText());
        if (immediateSelfService) {
            RequestIdentityService.Identity initiator = identity.orElseThrow();
            requestExecutor.execute(item, new ApprovedAssetRequestExecutor.Operator(
                initiator.name(), initiator.account(), initiator.directorySubject(), initiator.subject()));
            item.put("status", "已同意");
            item.put("system", "系统自动审批");
            item.put("currentNode", "已归档");
            item.put("approvalStatus", "APPROVED");
            item.put("approvalDate", java.time.LocalDate.now().toString());
            item.put("approvalExecutedAt", java.time.Instant.now().toString());
        } else if (approvalIntegration.enabled()) {
            item.put("system", "ECP审批");
            RequestIdentityService.Identity initiator = identity.orElseThrow(() ->
                new IllegalStateException("ECP identity is required to start an approval"));
            ApprovalIntegrationService.StartResult started = approvalIntegration.start(item, initiator);
            item.put("approvalNo", started.approvalNo());
            item.put("bizNo", started.bizNo());
            item.put("templateCode", started.templateCode());
            item.put("approvalStatus", started.status().isBlank() ? "PENDING" : started.status());
            item.put("currentNodeKey", started.currentNodeKey());
            item.put("currentNode", started.currentNodeName().isBlank() ? item.path("status").asText("审批中") : started.currentNodeName());
            item.put("approvalCreatedAt", started.createdAt());
        }

        if (approvalRequests.count() >= MAX_BUSINESS_ITEMS) {
            throw new IllegalStateException("Business request storage has reached its item limit");
        }
        validateSnapshot("requests", mapper.createArrayNode().add(item));
        ApprovalRequestRepository.RequestRecord created = approvalRequests.create(item);
        return ResponseEntity.status(HttpStatus.CREATED).body(Map.of("item", item, "version", created.version()));
    }

    @PostMapping("/requests/{id}/decision")
    @RequirePermission(permissions = "asset:request:review")
    public ResponseEntity<?> decideRequest(@PathVariable String id, @RequestBody RequestDecision command,
                                           HttpServletRequest request) {
        if (!Set.of("approve", "reject", "cancel").contains(command.decision())) throw new IllegalArgumentException("Unsupported request decision");
        var identity = identityService.current(request);
        String operator = identityService.trustedName(request, command.operator());
        RequestIdentityService.Identity currentIdentity = identity.orElse(null);
        ApprovedAssetRequestExecutor.Operator actor = new ApprovedAssetRequestExecutor.Operator(operator,
            currentIdentity == null ? "" : currentIdentity.account(),
            currentIdentity == null ? "" : currentIdentity.directorySubject(),
            currentIdentity == null ? "" : currentIdentity.subject());
        ObjectNode target = approvalRequests.find(id)
            .orElseThrow(() -> new IllegalArgumentException("Business item not found: " + id));
        if (approvalIntegration.enabled() && !target.path("approvalNo").asText("").isBlank()) {
            if (currentIdentity == null) throw new IllegalStateException("ECP identity is required to decide an approval");
            if (!Set.of("审批中", "待审批", "待执行").contains(target.path("status").asText())) {
                throw new IllegalArgumentException("Request is already finalized");
            }
            approvalIntegration.decide(target.path("approvalNo").asText(), command.decision(),
                currentIdentity.directorySubject(), command.reason());
            JsonNode items = approvalState.markExternalDecisionSubmitted(id, command.decision(), actor, command.reason());
            return ResponseEntity.ok(Map.of("items", items));
        }
        return ResponseEntity.ok(Map.of("items",
            approvalState.decideLocally(id, command.decision(), actor, command.reason())));
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
        item.put("status", "领用");
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

    private void validateRequestLocation(String requestType, JsonNode details) {
        String field = REQUEST_LOCATION_FIELDS.get(requestType == null ? "" : requestType.trim());
        if (field == null || details == null || !details.isObject()) return;
        String location = details.path(field).asText("").trim();
        if (!location.isEmpty() && !referenceCatalog.locations().contains(location)) {
            throw new IllegalArgumentException("Request location is not present in the server catalog: " + location);
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
