package team.acg.access.assets.asset;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Service
public class AssetService {
    private static final int MAX_ASSETS = 5_000;
    private static final Set<String> ALLOWED_STATUS = Set.of(
        "空闲", "闲置", "上架", "待验收", "在用", "借用中", "维修中", "审批中", "交接待签字", "已报废");
    private static final Set<String> AVAILABLE = Set.of("空闲", "闲置", "上架", "待验收");

    private final AssetRepository repository;
    private final ObjectMapper mapper;

    public AssetService(AssetRepository repository, ObjectMapper mapper) {
        this.repository = repository;
        this.mapper = mapper;
    }

    public List<JsonNode> list() {
        return repository.findAll();
    }

    @Transactional
    public Instant replaceAll(List<JsonNode> assets) {
        if (assets == null || assets.size() > MAX_ASSETS) {
            throw new IllegalArgumentException("Asset snapshot exceeds the 5000 record limit");
        }
        Map<String, JsonNode> existing = new HashMap<>();
        repository.findAll().forEach(asset -> existing.put(asset.path("id").asText(), asset));
        Set<String> ids = new HashSet<>();
        assets.forEach(asset -> validate(asset, existing.get(asset.path("id").asText()), ids));
        existing.forEach((id, asset) -> {
            if (!ids.contains(id) && !AVAILABLE.contains(asset.path("status").asText())) {
                throw new IllegalArgumentException("Only available assets can be deleted: " + id);
            }
        });
        Instant now = Instant.now();
        repository.replaceAll(assets, now);
        auditChanges(existing, assets, now);
        return now;
    }

    @Transactional
    public List<JsonNode> execute(String action, List<String> assetIds, JsonNode fields) {
        if (action == null || action.isBlank()) throw new IllegalArgumentException("Asset action is required");
        if (assetIds == null || assetIds.isEmpty() || assetIds.size() > 500) throw new IllegalArgumentException("Asset command requires between 1 and 500 asset ids");
        List<JsonNode> assets = repository.findAll();
        Map<String, ObjectNode> selected = new HashMap<>();
        assets.forEach(asset -> {
            if (assetIds.contains(asset.path("id").asText())) selected.put(asset.path("id").asText(), (ObjectNode) asset.deepCopy());
        });
        if (selected.size() != new HashSet<>(assetIds).size()) throw new IllegalArgumentException("One or more assets were not found");
        if ("delete".equals(action)) {
            selected.values().forEach(asset -> requireStatus(asset, AVAILABLE));
            List<JsonNode> retained = assets.stream().filter(asset -> !selected.containsKey(asset.path("id").asText())).toList();
            replaceAll(retained);
            return List.of();
        }
        selected.values().forEach(asset -> applyCommand(action, asset, fields == null ? mapper.createObjectNode() : fields));
        List<JsonNode> updated = assets.stream().map(asset -> (JsonNode) selected.getOrDefault(asset.path("id").asText(), (ObjectNode) asset)).toList();
        replaceAll(updated);
        return selected.values().stream().map(JsonNode.class::cast).toList();
    }

    @Transactional
    public JsonNode create(JsonNode draft) {
        return createMany(List.of(draft)).getFirst();
    }

    @Transactional
    public List<JsonNode> createMany(List<JsonNode> drafts) {
        if (drafts == null || drafts.isEmpty() || drafts.size() > MAX_ASSETS) throw new IllegalArgumentException("Asset import requires between 1 and 5000 rows");
        List<JsonNode> assets = repository.findAll();
        Set<String> ids = new HashSet<>();
        assets.forEach(item -> ids.add(item.path("id").asText()));
        List<JsonNode> created = drafts.stream().map(this::buildAsset).map(JsonNode.class::cast).toList();
        for (JsonNode asset : created) {
            if (!ids.add(asset.path("id").asText())) throw new IllegalArgumentException("Asset id already exists: " + asset.path("id").asText());
        }
        assets.addAll(0, created);
        replaceAll(assets);
        return created;
    }

    private ObjectNode buildAsset(JsonNode draft) {
        if (draft == null || !draft.isObject()) throw new IllegalArgumentException("Asset draft must be an object");
        ObjectNode asset = mapper.createObjectNode();
        Set<String> allowed = Set.of("id", "name", "category", "type", "model", "sn", "owner", "custodian", "department", "location", "supplier", "price", "rent", "purchaseDate", "receiveDate", "phone", "email", "purchaseMethod", "orderNo", "unit", "note", "brand", "company", "ownerCompany", "condition", "usageMonths");
        allowed.forEach(field -> { if (draft.has(field)) asset.set(field, draft.get(field)); });
        String owner = asset.path("owner").asText("").trim();
        String condition = asset.path("condition").asText("").trim();
        asset.put("owner", owner.isBlank() ? "未分配" : owner);
        asset.put("status", "维修中".equals(condition) ? "维修中" : owner.isBlank() ? "空闲" : "在用");
        ArrayNode lifecycle = mapper.createArrayNode();
        lifecycle.add(mapper.createArrayNode().add(date(asset.path("purchaseDate").asText())).add("资产入库").add("通过新增资产表单录入"));
        if (!owner.isBlank()) lifecycle.add(mapper.createArrayNode().add(date(asset.path("receiveDate").asText())).add("资产领用").add(owner + " 领用 " + asset.path("name").asText()));
        asset.set("lifecycle", lifecycle);
        return asset;
    }

    private void applyCommand(String action, ObjectNode asset, JsonNode fields) {
        String name = asset.path("name").asText();
        switch (action) {
            case "receive" -> {
                requireStatus(asset, AVAILABLE);
                String receiver = requiredField(fields, "receiver");
                copyText(fields, asset, "department", "company", "location", "note");
                asset.put("owner", receiver); asset.put("status", "在用"); asset.put("receiveDate", date(requiredField(fields, "date")));
                lifecycle(asset, fields, "资产领用", receiver + " 领用 " + name);
            }
            case "return" -> {
                requireStatus(asset, Set.of("在用"));
                copyText(fields, asset, "department", "company", "location", "note");
                asset.put("owner", "未分配"); asset.put("status", "空闲"); asset.put("receiveDate", ""); asset.put("returnDate", date(requiredField(fields, "date")));
                lifecycle(asset, fields, "资产退库", requiredField(fields, "operator") + " 办理 " + name + " 退库");
            }
            case "borrow" -> {
                requireStatus(asset, AVAILABLE);
                String borrower = requiredField(fields, "borrower");
                copyText(fields, asset, "department", "company", "location", "note");
                asset.put("owner", borrower); asset.put("status", "借用中"); asset.put("borrowDate", date(requiredField(fields, "date")));
                String expected = fields.path("expectedReturnDates").path(asset.path("id").asText()).asText(fields.path("expectedReturnDate").asText());
                asset.put("expectedReturnDate", date(expected)); lifecycle(asset, fields, "资产借用", borrower + " 借用 " + name);
            }
            case "borrow-return" -> {
                requireStatus(asset, Set.of("借用中"));
                copyText(fields, asset, "location", "note");
                asset.put("owner", "未分配"); asset.put("status", "空闲"); asset.put("borrowDate", ""); asset.put("expectedReturnDate", ""); asset.put("returnDate", date(requiredField(fields, "date")));
                lifecycle(asset, fields, "借用归还", requiredField(fields, "operator") + " 办理 " + name + " 归还");
            }
            case "handover" -> {
                requireStatus(asset, Set.of("在用", "借用中", "交接待签字"));
                String receiver = requiredField(fields, "receiver");
                copyText(fields, asset, "company", "department", "location", "note");
                asset.put("owner", receiver); asset.put("status", "在用"); asset.put("handoverDate", date(requiredField(fields, "date"))); asset.put("handoverType", fields.path("handoverType").asText("员工交接"));
                lifecycle(asset, fields, "资产交接", name + " 交接给 " + receiver);
            }
            case "handover-sign" -> {
                requireStatus(asset, Set.of("交接待签字"));
                asset.put("status", "在用");
                lifecycle(asset, fields, "交接签字", asset.path("owner").asText("接收人") + " 已确认交接");
            }
            case "handover-cancel" -> {
                requireStatus(asset, Set.of("交接待签字"));
                asset.put("status", "在用");
                lifecycle(asset, fields, "取消交接", requiredField(fields, "operator") + " 取消交接单");
            }
            case "borrow-delay" -> {
                requireStatus(asset, Set.of("借用中"));
                String expected = date(requiredField(fields, "expectedReturnDate"));
                asset.put("expectedReturnDate", expected);
                lifecycle(asset, fields, "借用延期", requiredField(fields, "operator") + " 延期 " + name + " 至 " + expected);
            }
            case "cancel-inbound" -> {
                if ("已取消".equals(asset.path("inboundStatus").asText())) throw new IllegalArgumentException("Inbound order is already cancelled");
                asset.put("inboundStatus", "已取消");
                lifecycle(asset, fields, "取消入库", requiredField(fields, "operator") + " 取消资产入库单");
            }
            case "reference-edit" -> {
                if (fields.has("category")) {
                    asset.put("category", requiredField(fields, "category"));
                    asset.put("type", fields.path("type").asText(fields.path("category").asText()));
                }
                if (fields.has("location")) asset.put("location", requiredField(fields, "location"));
                lifecycle(asset, fields, "基础数据联动", requiredField(fields, "description"));
            }
            case "edit", "batch-edit" -> {
                Set<String> allowed = Set.of("owner", "company", "department", "receiveDate", "name", "category", "type", "custodian", "brand", "model", "ownerCompany", "condition", "location", "price", "purchaseDate", "purchaseMethod", "orderNo", "unit", "rent", "note");
                allowed.forEach(field -> { if (fields.has(field)) asset.set(field, fields.get(field)); });
                if (fields.has("condition")) asset.put("status", "维修中".equals(fields.path("condition").asText()) ? "维修中" : asset.path("owner").asText("未分配").equals("未分配") ? "空闲" : "在用");
                lifecycle(asset, fields, "batch-edit".equals(action) ? "批量修改" : "资产编辑", "通过管理端更新资产信息");
            }
            default -> throw new IllegalArgumentException("Unsupported asset action: " + action);
        }
    }

    private void requireStatus(ObjectNode asset, Set<String> allowed) {
        if (!allowed.contains(asset.path("status").asText())) throw new IllegalArgumentException("Asset is not eligible for this operation: " + asset.path("id").asText());
    }

    private String requiredField(JsonNode fields, String name) {
        String value = fields.path(name).asText("").trim();
        if (value.isBlank()) throw new IllegalArgumentException("Asset command field is required: " + name);
        return value;
    }

    private void copyText(JsonNode fields, ObjectNode asset, String... names) {
        for (String name : names) if (fields.has(name)) asset.put(name, fields.path(name).asText());
    }

    private String date(String value) {
        if (value == null || value.isBlank()) return java.time.LocalDate.now().toString();
        return java.time.LocalDate.parse(value).toString();
    }

    private void lifecycle(ObjectNode asset, JsonNode fields, String action, String description) {
        ArrayNode history = asset.path("lifecycle").isArray() ? (ArrayNode) asset.path("lifecycle") : mapper.createArrayNode();
        history.add(mapper.createArrayNode().add(date(fields.path("date").asText())).add(action).add(description));
        asset.set("lifecycle", history);
    }

    private void validate(JsonNode asset, JsonNode existing, Set<String> ids) {
        if (asset == null || !asset.isObject()) throw new IllegalArgumentException("Every asset must be an object");
        String id = requiredText(asset, "id", 191);
        requiredText(asset, "name", 255);
        requiredText(asset, "category", 128);
        String status = requiredText(asset, "status", 32);
        if (!ids.add(id)) throw new IllegalArgumentException("Duplicate asset id: " + id);
        if (!id.matches("[A-Za-z0-9._:/-]+")) throw new IllegalArgumentException("Invalid asset id: " + id);
        if (!ALLOWED_STATUS.contains(status)) throw new IllegalArgumentException("Unsupported asset status: " + status);
        validateMoney(asset, "price");
        validateMoney(asset, "rent");

        JsonNode lifecycle = asset.path("lifecycle");
        if (!lifecycle.isMissingNode() && !lifecycle.isArray()) {
            throw new IllegalArgumentException("Asset lifecycle must be an array: " + id);
        }
        if (lifecycle.size() > 500) throw new IllegalArgumentException("Asset lifecycle is too large: " + id);
        if (existing != null && lifecycle.size() < existing.path("lifecycle").size()) {
            throw new IllegalArgumentException("Asset lifecycle cannot be truncated: " + id);
        }
        if (existing != null) validateStatusTransition(id, existing.path("status").asText(), status);
    }

    private void validateStatusTransition(String id, String before, String after) {
        if (before.equals(after)) return;
        boolean allowed = switch (before) {
            case "空闲", "闲置", "上架", "待验收" -> Set.of("在用", "借用中", "维修中", "审批中", "已报废").contains(after);
            case "在用" -> Set.of("空闲", "闲置", "维修中", "审批中", "交接待签字", "已报废").contains(after);
            case "借用中" -> Set.of("空闲", "闲置", "维修中", "审批中", "交接待签字").contains(after);
            case "维修中" -> Set.of("空闲", "闲置", "在用", "已报废").contains(after);
            case "审批中" -> Set.of("空闲", "闲置", "在用", "借用中", "已报废").contains(after);
            case "交接待签字" -> Set.of("在用", "借用中").contains(after);
            case "已报废" -> false;
            default -> false;
        };
        if (!allowed) throw new IllegalArgumentException("Invalid asset status transition for " + id + ": " + before + " -> " + after);
    }

    private void auditChanges(Map<String, JsonNode> existing, List<JsonNode> assets, Instant now) {
        Map<String, JsonNode> current = new HashMap<>();
        assets.forEach(asset -> current.put(asset.path("id").asText(), asset));
        current.forEach((id, asset) -> {
            JsonNode before = existing.get(id);
            String afterStatus = asset.path("status").asText();
            if (before == null) repository.appendAudit(id, "CREATE", null, afterStatus, now);
            else if (!before.path("status").asText().equals(afterStatus)) {
                repository.appendAudit(id, "STATUS_CHANGE", before.path("status").asText(), afterStatus, now);
            }
        });
        existing.forEach((id, asset) -> {
            if (!current.containsKey(id)) repository.appendAudit(id, "DELETE", asset.path("status").asText(), null, now);
        });
    }

    private String requiredText(JsonNode asset, String field, int maxLength) {
        String value = asset.path(field).asText("").trim();
        if (value.isEmpty()) throw new IllegalArgumentException("Asset field is required: " + field);
        if (value.length() > maxLength) throw new IllegalArgumentException("Asset field is too long: " + field);
        return value;
    }

    private void validateMoney(JsonNode asset, String field) {
        JsonNode value = asset.path(field);
        if (value.isMissingNode() || value.isNull()) return;
        try {
            BigDecimal amount = value.decimalValue();
            if (amount.signum() < 0 || amount.compareTo(new BigDecimal("999999999999.99")) > 0) {
                throw new IllegalArgumentException("Asset amount is out of range: " + field);
            }
        } catch (ArithmeticException error) {
            throw new IllegalArgumentException("Asset amount is invalid: " + field);
        }
    }
}
