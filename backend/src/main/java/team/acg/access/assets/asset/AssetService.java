package team.acg.access.assets.asset;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.HashMap;
import java.util.HashSet;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import team.acg.access.assets.auth.RequestIdentityService;
import team.acg.access.assets.store.PortalReferenceCatalog;

@Service
public class AssetService {
    private static final int MAX_ASSETS = 5_000;
    private static final Set<String> ALLOWED_STATUS = Set.of(
        "空闲", "闲置", "上架", "待验收", "领用", "借用中", "维修中", "审批中",
        "领用待签字", "借用待签字", "交接待签字", "处置中", "已处置", "已报废");
    private static final Set<String> UNASSIGNED = Set.of("空闲", "闲置", "上架", "待验收");
    private static final Set<String> ASSIGNABLE = Set.of("空闲");
    private static final Set<String> PENDING_SIGNATURE_STATUSES = Set.of("领用待签字", "借用待签字", "交接待签字");
    private static final Set<String> CURRENT_USAGE_FIELDS = Set.of(
        "ownerSubject", "company", "companyUnionId", "department", "departmentUnionId",
        "employeeCode", "phone", "email", "receiveDate", "borrowDate", "expectedReturnDate",
        "handoverDate", "handoverType");
    private final AssetRepository repository;
    private final ObjectMapper mapper;
    private final PortalReferenceCatalog referenceCatalog;
    private final AssetCodeGenerator codeGenerator;
    private final AssetWorkflowPolicy workflowPolicy;
    private final AssetOperationRepository operationRepository;
    public static final Actor SYSTEM = Actor.SYSTEM;

    public AssetService(AssetRepository repository, ObjectMapper mapper, PortalReferenceCatalog referenceCatalog,
                        AssetCodeGenerator codeGenerator, AssetWorkflowPolicy workflowPolicy,
                        AssetOperationRepository operationRepository) {
        this.repository = repository;
        this.mapper = mapper;
        this.referenceCatalog = referenceCatalog;
        this.codeGenerator = codeGenerator;
        this.workflowPolicy = workflowPolicy;
        this.operationRepository = operationRepository;
    }

    public List<JsonNode> list() {
        return repository.findActive();
    }

    public long disposedCount() {
        return repository.countByStatus("已处置");
    }

    public List<JsonNode> listFor(RequestIdentityService.Identity identity) {
        if (identity.manager()) return list();
        boolean canCreateRequest = identity.hasPermission("asset:request:create");
        return list().stream().filter(asset -> {
            String ownerSubject = asset.path("ownerSubject").asText();
            boolean owned = (!identity.subject().isBlank() && identity.subject().equals(ownerSubject))
                || (!identity.directorySubject().isBlank() && identity.directorySubject().equals(ownerSubject));
            return owned || canCreateRequest && UNASSIGNED.contains(asset.path("status").asText());
        })
            .toList();
    }

    public List<JsonNode> findAccessibleByIds(RequestIdentityService.Identity identity, Collection<String> assetIds) {
        if (assetIds == null || assetIds.isEmpty()) return List.of();
        Set<String> requested = Set.copyOf(assetIds);
        return listFor(identity).stream()
            .filter(asset -> requested.contains(asset.path("id").asText()))
            .toList();
    }

    public boolean isAvailable(JsonNode asset) {
        return asset != null && ASSIGNABLE.contains(asset.path("status").asText());
    }

    @Transactional
    public void requireOwnedForApprovedRequest(Collection<String> assetIds, String ownerSubject,
                                               Set<String> allowedStatuses) {
        if (ownerSubject == null || ownerSubject.isBlank()) {
            throw new IllegalArgumentException("Approved request has no stable applicant subject");
        }
        repository.lockForWrite();
        Map<String, JsonNode> assets = repository.findAll().stream().collect(java.util.stream.Collectors.toMap(
            asset -> asset.path("id").asText(), asset -> asset));
        for (String assetId : assetIds) {
            JsonNode asset = assets.get(assetId);
            if (asset == null) throw new IllegalArgumentException("Requested asset was not found: " + assetId);
            if (!ownerSubject.equals(asset.path("ownerSubject").asText())) {
                throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Requested asset owner changed before approval: " + assetId);
            }
            if (!allowedStatuses.contains(asset.path("status").asText())) {
                throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Requested asset status changed before approval: " + assetId);
            }
        }
    }

    @Transactional
    public void requireStatusForApprovedRequest(Collection<String> assetIds, Set<String> allowedStatuses) {
        repository.lockForWrite();
        Map<String, JsonNode> assets = repository.findAll().stream().collect(java.util.stream.Collectors.toMap(
            asset -> asset.path("id").asText(), asset -> asset));
        for (String assetId : assetIds) {
            JsonNode asset = assets.get(assetId);
            if (asset == null) throw new IllegalArgumentException("Requested asset was not found: " + assetId);
            if (!allowedStatuses.contains(asset.path("status").asText())) {
                throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Requested asset status changed before approval: " + assetId);
            }
        }
    }

    @Transactional
    public Instant replaceAll(List<JsonNode> assets) {
        if (assets == null || assets.size() > MAX_ASSETS) {
            throw new IllegalArgumentException("Asset snapshot exceeds the 5000 record limit");
        }
        repository.lockForWrite();
        Map<String, AssetRepository.AssetRecord> existingRecords = repository.findAllRecords();
        Map<String, JsonNode> existing = new HashMap<>();
        existingRecords.forEach((id, record) -> existing.put(id, record.document()));
        Set<String> allowedCategories = referenceCatalog.categories();
        Set<String> allowedLocations = referenceCatalog.locations();
        Set<String> ids = new HashSet<>();
        assets.forEach(this::normalizeUnassignedUsage);
        assets.forEach(asset -> validate(asset, existing.get(asset.path("id").asText()), ids,
            allowedCategories, allowedLocations));
        existing.forEach((id, asset) -> {
            if (!ids.contains(id) && !UNASSIGNED.contains(asset.path("status").asText())) {
                throw new IllegalArgumentException("Only available assets can be deleted: " + id);
            }
        });
        Instant now = Instant.now();
        repository.replaceAll(assets, existingRecords, now);
        auditChanges(existing, assets, now);
        return now;
    }

    @Transactional
    public List<JsonNode> replaceCatalog(List<JsonNode> drafts, Actor actor) {
        return replaceCatalog(drafts, actor, false);
    }

    @Transactional
    public List<JsonNode> replaceCatalog(List<JsonNode> drafts, Actor actor, boolean resetHistory) {
        if (drafts == null || drafts.isEmpty() || drafts.size() > MAX_ASSETS) {
            throw new IllegalArgumentException("Asset replacement requires between 1 and 5000 rows");
        }
        repository.lockForWrite();
        Map<String, AssetRepository.AssetRecord> existingRecords = repository.findAllRecords();
        Map<String, JsonNode> existing = new LinkedHashMap<>();
        existingRecords.forEach((id, record) -> existing.put(id, record.document()));
        Set<String> ids = new LinkedHashSet<>();
        List<JsonNode> replacement = new ArrayList<>();
        Set<String> allowedCategories = referenceCatalog.categories();
        Set<String> allowedLocations = referenceCatalog.locations();
        String defaultLocation = allowedLocations.contains("杭州公司") ? "杭州公司"
            : allowedLocations.stream().sorted().findFirst()
                .orElseThrow(() -> new IllegalArgumentException("Asset location catalog is empty"));
        Set<String> copyFields = Set.of(
            "brand", "model", "sn", "owner", "ownerSubject", "department", "departmentUnionId",
            "company", "companyUnionId", "ownerCompany", "location", "custodian", "supplier",
            "price", "rent", "purchaseDate", "receiveDate", "phone", "email", "purchaseMethod",
            "orderNo", "unit", "note");
        String today = java.time.LocalDate.now().toString();

        for (JsonNode draft : drafts) {
            if (draft == null || !draft.isObject()) {
                throw new IllegalArgumentException("Every replacement asset must be an object");
            }
            String id = requiredText(draft, "id", 191);
            if (!ids.add(id)) throw new IllegalArgumentException("Duplicate asset id: " + id);
            JsonNode previous = existing.get(id);
            ObjectNode asset = !resetHistory && previous != null && previous.isObject()
                ? (ObjectNode) previous.deepCopy() : mapper.createObjectNode();
            asset.put("id", id);
            String category = requiredText(draft, "category", 128);
            String name = draft.path("name").asText("").trim();
            if (name.isEmpty()) name = resetHistory || previous == null
                ? category + "资产" : previous.path("name").asText(category + "资产");
            asset.put("name", name);
            asset.put("category", category);
            asset.put("type", category);
            copyFields.forEach(field -> { if (draft.has(field)) asset.set(field, draft.get(field)); });

            String owner = asset.path("owner").asText("").trim();
            if (owner.isEmpty() || "未分配".equals(owner)) {
                asset.put("owner", "未分配");
                asset.put("ownerSubject", "");
            }
            String location = asset.path("location").asText("").trim();
            asset.put("location", location.isEmpty() ? defaultLocation : location);
            if (resetHistory || previous == null) {
                if (!asset.has("price")) asset.put("price", 0);
                if (!asset.has("rent")) asset.put("rent", 0);
                if (!asset.has("purchaseMethod")) asset.put("purchaseMethod", "采购");
                if (!asset.has("purchaseDate")) asset.put("purchaseDate", today);
                if (!asset.has("receiveDate")) asset.put("receiveDate", asset.path("ownerSubject").asText("").isBlank() ? "" : today);
                if (!asset.has("custodian")) asset.put("custodian", actor == null ? "系统" : actor.name());
                ArrayNode lifecycle = mapper.createArrayNode();
                lifecycle.add(mapper.createArrayNode().add(today).add("资产清单替换").add("通过完整资产清单导入"));
                asset.set("lifecycle", lifecycle);
            }
            String status = normalizeReplacementStatus(requiredText(draft, "status", 32));
            asset.put("status", status);
            if (!resetHistory) rejectWorkflowChangesDuringPendingSignature(previous, asset);
            clearStaleWorkflowFields(asset, status);
            normalizeUnassignedUsage(asset);
            replacement.add(asset);
        }

        Set<String> validatedIds = new HashSet<>();
        replacement.forEach(asset -> validate(asset, null, validatedIds, allowedCategories, allowedLocations));
        Instant now = Instant.now();
        repository.replaceAll(replacement, existingRecords, now);
        auditChanges(existing, replacement, now);
        Actor trustedActor = actor == null ? Actor.SYSTEM : actor;
        replacement.stream().filter(asset -> !existing.containsKey(asset.path("id").asText()))
            .forEach(asset -> recordInitialOperations(asset, trustedActor));
        return replacement;
    }

    @Transactional
    public List<JsonNode> execute(String action, List<String> assetIds, JsonNode fields) {
        if (action == null || action.isBlank()) throw new IllegalArgumentException("Asset action is required");
        int maximum = isImportAction(action) ? MAX_ASSETS : 500;
        if (assetIds == null || assetIds.isEmpty() || assetIds.size() > maximum) {
            throw new IllegalArgumentException("Asset command requires between 1 and " + maximum + " asset ids");
        }
        Set<String> requestedIds = new LinkedHashSet<>(assetIds);
        if (requestedIds.size() != assetIds.size()) throw new IllegalArgumentException("Asset command contains duplicate asset ids");
        Map<String, JsonNode> importOperations = isImportAction(action)
            ? importOperations(requestedIds, fields)
            : Map.of();
        repository.lockForWrite();
        List<JsonNode> assets = repository.findAll();
        Map<String, ObjectNode> selected = new LinkedHashMap<>();
        assets.forEach(asset -> {
            if (requestedIds.contains(asset.path("id").asText())) selected.put(asset.path("id").asText(), (ObjectNode) asset.deepCopy());
        });
        if (selected.size() != requestedIds.size()) throw new IllegalArgumentException("One or more assets were not found");
        Map<String, ObjectNode> before = new LinkedHashMap<>();
        selected.forEach((id, asset) -> before.put(id, asset.deepCopy()));
        if ("delete".equals(action)) {
            selected.values().forEach(asset -> requireStatus(asset, UNASSIGNED));
            List<JsonNode> retained = assets.stream().filter(asset -> !selected.containsKey(asset.path("id").asText())).toList();
            replaceAll(retained);
            return List.of();
        }
        if (isImportAction(action)) {
            String itemAction = "update-import".equals(action) ? "edit" : "receive";
            selected.forEach((assetId, asset) -> applyCommand(itemAction, asset, importOperations.get(assetId)));
        } else {
            selected.values().forEach(asset -> applyCommand(action, asset, fields == null ? mapper.createObjectNode() : fields));
        }
        List<JsonNode> updated = assets.stream()
            .filter(asset -> !"cancel-inbound".equals(action) || !selected.containsKey(asset.path("id").asText()))
            .map(asset -> (JsonNode) selected.getOrDefault(asset.path("id").asText(), (ObjectNode) asset))
            .toList();
        replaceAll(updated);
        recordCommandOperations(action, selected, before, fields, importOperations);
        return selected.values().stream().map(JsonNode.class::cast).toList();
    }

    @Transactional
    public JsonNode create(JsonNode draft) {
        return create(draft, Actor.SYSTEM);
    }

    @Transactional
    public JsonNode create(JsonNode draft, Actor actor) {
        if (draft == null) throw new IllegalArgumentException("Asset draft is required");
        return createMany(List.of(draft), actor).get(0);
    }

    @Transactional
    public JsonNode copy(String sourceAssetId, JsonNode requestedCopy) {
        return copy(sourceAssetId, requestedCopy, Actor.SYSTEM);
    }

    @Transactional
    public JsonNode copy(String sourceAssetId, JsonNode requestedCopy, Actor actor) {
        repository.lockForWrite();
        JsonNode source = repository.find(sourceAssetId);
        if (source == null) throw new IllegalArgumentException("Source asset was not found: " + sourceAssetId);
        if (requestedCopy == null || !requestedCopy.isObject()) {
            throw new IllegalArgumentException("Asset copy request must contain an item object");
        }
        ObjectNode draft = (ObjectNode) source.deepCopy();
        draft.put("id", "");
        draft.put("name", requiredText(requestedCopy, "name", 255));
        draft.put("owner", "未分配");
        draft.put("ownerSubject", "");
        draft.put("condition", "");
        draft.put("receiveDate", "");
        return createMany(List.of(draft), actor).get(0);
    }

    @Transactional
    public List<JsonNode> createMany(List<JsonNode> drafts) {
        return createMany(drafts, Actor.SYSTEM);
    }

    @Transactional
    public List<JsonNode> createMany(List<JsonNode> drafts, Actor actor) {
        if (drafts == null || drafts.isEmpty() || drafts.size() > MAX_ASSETS) throw new IllegalArgumentException("Asset import requires between 1 and 5000 rows");
        repository.lockForWrite();
        List<JsonNode> assets = repository.findAll();
        Set<String> ids = new HashSet<>();
        assets.forEach(item -> ids.add(item.path("id").asText()));
        List<JsonNode> prepared = new ArrayList<>();
        for (JsonNode draft : drafts) {
            if (draft == null || !draft.isObject()) throw new IllegalArgumentException("Asset draft must be an object");
            ObjectNode item = (ObjectNode) draft.deepCopy();
            String id = item.path("id").asText("").trim();
            if (id.isEmpty()) id = codeGenerator.nextCode(item, ids);
            item.put("id", id);
            if (!ids.add(id)) throw new IllegalArgumentException("Asset id already exists: " + id);
            prepared.add(item);
        }
        List<JsonNode> created = prepared.stream().map(this::buildAsset).map(JsonNode.class::cast).toList();
        assets.addAll(0, created);
        replaceAll(assets);
        Actor trustedActor = actor == null ? Actor.SYSTEM : actor;
        created.forEach(asset -> recordInitialOperations(asset, trustedActor));
        return created;
    }

    private ObjectNode buildAsset(JsonNode draft) {
        if (draft == null || !draft.isObject()) throw new IllegalArgumentException("Asset draft must be an object");
        ObjectNode asset = mapper.createObjectNode();
        Set<String> allowed = Set.of("id", "name", "category", "type", "model", "sn", "owner", "ownerSubject",
            "custodian", "department", "departmentUnionId", "location", "supplier", "price", "rent", "purchaseDate",
            "receiveDate", "phone", "email", "purchaseMethod", "orderNo", "unit", "note", "brand", "company",
            "companyUnionId", "ownerCompany", "condition", "usageMonths");
        allowed.forEach(field -> { if (draft.has(field)) asset.set(field, draft.get(field)); });
        String category = requiredText(asset, "category", 128);
        String location = requiredText(asset, "location", 255);
        asset.put("category", category);
        asset.put("type", category);
        asset.put("location", location);
        String owner = asset.path("owner").asText("").trim();
        String condition = asset.path("condition").asText("").trim();
        boolean assigned = !owner.isBlank() && !"未分配".equals(owner);
        if (assigned) requiredText(asset, "ownerSubject", 191);
        asset.put("owner", assigned ? owner : "未分配");
        asset.put("status", "维修中".equals(condition) ? "维修中" : assigned ? "领用" : "空闲");
        ArrayNode lifecycle = mapper.createArrayNode();
        lifecycle.add(mapper.createArrayNode().add(date(asset.path("purchaseDate").asText())).add("资产入库").add("通过新增资产表单录入"));
        if (assigned) lifecycle.add(mapper.createArrayNode().add(date(asset.path("receiveDate").asText())).add("资产领用").add(owner + " 领用 " + asset.path("name").asText()));
        asset.set("lifecycle", lifecycle);
        return asset;
    }

    private void applyCommand(String action, ObjectNode asset, JsonNode fields) {
        String name = asset.path("name").asText();
        switch (action) {
            case "receive" -> {
                requireStatus(asset, ASSIGNABLE);
                String receiver = requiredField(fields, "receiver");
                String receiverSubject = requiredField(fields, "receiverSubject");
                String location = requiredField(fields, "location");
                boolean requiresSignature = workflowPolicy.requiresEmployeeSignature(
                    "RECEIVE", fields.path("selfServiceRequest").asBoolean(false));
                if (requiresSignature) snapshotReceipt(asset);
                copyText(fields, asset, "department", "departmentUnionId", "company", "companyUnionId", "note");
                asset.put("location", location);
                copyText(fields, asset, "custodian");
                asset.put("owner", receiver); asset.put("ownerSubject", receiverSubject);
                asset.put("status", requiresSignature ? "领用待签字" : "领用");
                asset.put("receiveDate", date(requiredField(fields, "date")));
                lifecycle(asset, fields, requiresSignature ? "发起资产领用" : "资产领用",
                    requiresSignature ? name + " 待 " + receiver + " 签字确认" : receiver + " 领用 " + name);
                if (!requiresSignature) clearReceiptSnapshot(asset);
            }
            case "return" -> {
                requireStatus(asset, Set.of("领用"));
                String location = requiredField(fields, "location");
                copyText(fields, asset, "note");
                asset.put("location", location);
                asset.put("owner", "未分配"); asset.put("ownerSubject", ""); asset.put("status", "空闲");
                asset.put("receiveDate", ""); asset.put("returnDate", date(requiredField(fields, "date")));
                lifecycle(asset, fields, "资产退库", requiredField(fields, "operator") + " 办理 " + name + " 退库");
            }
            case "borrow" -> {
                requireStatus(asset, ASSIGNABLE);
                String borrower = requiredField(fields, "borrower");
                String borrowerSubject = requiredField(fields, "borrowerSubject");
                String location = requiredField(fields, "location");
                boolean requiresSignature = workflowPolicy.requiresEmployeeSignature(
                    "BORROW", fields.path("selfServiceRequest").asBoolean(false));
                if (requiresSignature) snapshotReceipt(asset);
                copyText(fields, asset, "department", "departmentUnionId", "company", "companyUnionId", "note");
                asset.put("location", location);
                copyText(fields, asset, "custodian");
                asset.put("owner", borrower); asset.put("ownerSubject", borrowerSubject);
                asset.put("status", requiresSignature ? "借用待签字" : "借用中");
                asset.put("borrowDate", date(requiredField(fields, "date")));
                String expected = fields.path("expectedReturnDates").path(asset.path("id").asText()).asText(fields.path("expectedReturnDate").asText());
                asset.put("expectedReturnDate", date(expected));
                lifecycle(asset, fields, requiresSignature ? "发起资产借用" : "资产借用",
                    requiresSignature ? name + " 待 " + borrower + " 签字确认" : borrower + " 借用 " + name);
                if (!requiresSignature) clearReceiptSnapshot(asset);
            }
            case "borrow-return" -> {
                requireStatus(asset, Set.of("借用中"));
                String location = requiredField(fields, "location");
                copyText(fields, asset, "note");
                asset.put("location", location);
                asset.put("owner", "未分配"); asset.put("ownerSubject", ""); asset.put("status", "空闲");
                asset.put("borrowDate", ""); asset.put("expectedReturnDate", ""); asset.put("returnDate", date(requiredField(fields, "date")));
                lifecycle(asset, fields, "借用归还", requiredField(fields, "operator") + " 办理 " + name + " 归还");
            }
            case "handover" -> {
                requireStatus(asset, Set.of("领用", "借用中"));
                String receiver = requiredField(fields, "receiver");
                String receiverSubject = requiredField(fields, "receiverSubject");
                String location = requiredField(fields, "location");
                snapshotReceipt(asset);
                copyText(fields, asset, "company", "companyUnionId", "department", "departmentUnionId", "note");
                asset.put("location", location);
                asset.put("owner", receiver); asset.put("ownerSubject", receiverSubject);
                asset.put("handoverDate", date(requiredField(fields, "date"))); asset.put("handoverType", fields.path("handoverType").asText("员工交接"));
                if (AssetPartyResolver.PUBLIC_AREA_SUBJECT.equals(receiverSubject)
                    || !workflowPolicy.requiresEmployeeSignature(
                        "HANDOVER", fields.path("selfServiceRequest").asBoolean(false))) {
                    asset.put("status", "领用");
                    lifecycle(asset, fields,
                        AssetPartyResolver.PUBLIC_AREA_SUBJECT.equals(receiverSubject) ? "公共区域交接" : "资产交接",
                        name + " 已交接至 " + receiver);
                    clearReceiptSnapshot(asset);
                } else {
                    asset.put("status", "交接待签字");
                    lifecycle(asset, fields, "发起资产交接", name + " 待 " + receiver + " 签字确认");
                }
            }
            case "handover-sign" -> {
                requireStatus(asset, Set.of("交接待签字"));
                String receiverSubject = asset.path("ownerSubject").asText("").trim();
                String operatorSubject = fields.path("operatorSubject").asText("").trim();
                if (receiverSubject.isBlank() || operatorSubject.isBlank() || !receiverSubject.equals(operatorSubject)) {
                    throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                        "Only the designated handover receiver can sign this asset");
                }
                asset.put("status", "领用");
                lifecycle(asset, fields, "交接签字", asset.path("owner").asText("接收人") + " 已确认交接");
                clearReceiptSnapshot(asset);
            }
            case "handover-cancel" -> {
                cancelPendingHandover(asset, fields, false);
            }
            case "handover-reject" -> {
                requiredField(fields, "reason");
                cancelPendingHandover(asset, fields, true);
            }
            case "receipt-sign" -> completeReceipt(asset, fields);
            case "receipt-reject" -> rejectReceipt(asset, fields, false);
            case "receipt-cancel" -> rejectReceipt(asset, fields, true);
            case "borrow-delay" -> {
                requireStatus(asset, Set.of("借用中"));
                String expected = date(requiredField(fields, "expectedReturnDate"));
                asset.put("expectedReturnDate", expected);
                lifecycle(asset, fields, "借用延期", requiredField(fields, "operator") + " 延期 " + name + " 至 " + expected);
            }
            case "repair-start" -> {
                requireStatus(asset, Set.of("空闲", "闲置", "上架", "待验收", "领用", "借用中"));
                asset.put("repairPreviousStatus", asset.path("status").asText());
                asset.put("status", "维修中");
                asset.put("repairStartedAt", date(fields.path("date").asText()));
                lifecycle(asset, fields, "资产报修", requiredField(fields, "operator") + " 提交 " + name + " 维修");
            }
            case "repair-complete" -> {
                requireStatus(asset, Set.of("维修中"));
                String nextStatus = fields.path("restoreStatus").asText(asset.path("repairPreviousStatus").asText("空闲")).trim();
                if (nextStatus.isBlank() || "维修中".equals(nextStatus) || !ALLOWED_STATUS.contains(nextStatus)) {
                    nextStatus = "空闲";
                }
                asset.put("status", nextStatus);
                asset.remove(List.of("repairPreviousStatus", "repairStartedAt"));
                lifecycle(asset, fields, "维修归档", requiredField(fields, "operator") + " 完成 " + name + " 维修");
            }
            case "disposal-start" -> {
                requireStatus(asset, ASSIGNABLE);
                asset.put("disposalPreviousStatus", asset.path("status").asText("空闲"));
                asset.put("disposalId", requiredField(fields, "disposalId"));
                asset.put("status", "处置中");
                asset.put("disposalStartedAt", date(fields.path("date").asText()));
                lifecycle(asset, fields, "发起资产处置", requiredField(fields, "operator") + " 提交 " + name + " 处置");
            }
            case "disposal-complete" -> {
                requireStatus(asset, Set.of("处置中"));
                if (!requiredField(fields, "disposalId").equals(asset.path("disposalId").asText())) {
                    throw new IllegalArgumentException("Asset belongs to another disposal order: " + asset.path("id").asText());
                }
                asset.put("status", "已处置");
                asset.put("disposedAt", date(fields.path("date").asText()));
                lifecycle(asset, fields, "完成资产处置", requiredField(fields, "operator") + " 完成 " + name + " 处置");
            }
            case "disposal-cancel" -> {
                requireStatus(asset, Set.of("处置中", "已处置"));
                if (!requiredField(fields, "disposalId").equals(asset.path("disposalId").asText())) {
                    throw new IllegalArgumentException("Asset belongs to another disposal order: " + asset.path("id").asText());
                }
                String restored = asset.path("disposalPreviousStatus").asText("空闲");
                if (!ALLOWED_STATUS.contains(restored) || Set.of("处置中", "已处置").contains(restored)) restored = "空闲";
                asset.put("status", restored);
                asset.remove(List.of("disposalPreviousStatus", "disposalId", "disposalStartedAt", "disposedAt"));
                lifecycle(asset, fields, "取消资产处置", requiredField(fields, "operator") + " 取消 " + name + " 处置");
            }
            case "cancel-inbound" -> {
                requireStatus(asset, UNASSIGNED);
                String owner = asset.path("owner").asText("").trim();
                String ownerSubject = asset.path("ownerSubject").asText("").trim();
                if ((!owner.isBlank() && !"未分配".equals(owner)) || !ownerSubject.isBlank()) {
                    throw new IllegalArgumentException("Only unassigned assets can have inbound cancelled: " + asset.path("id").asText());
                }
                if ("已取消".equals(asset.path("inboundStatus").asText())) throw new IllegalArgumentException("Inbound order is already cancelled");
                asset.put("inboundStatus", "已取消");
                lifecycle(asset, fields, "取消入库", requiredField(fields, "operator") + " 取消资产入库单");
            }
            case "reference-edit" -> {
                boolean changed = false;
                if (fields.has("category")) {
                    String category = requiredField(fields, "category");
                    if (!category.equals(asset.path("category").asText())) {
                        asset.put("category", category);
                        asset.put("type", category);
                        changed = true;
                    }
                }
                if (fields.has("location")) {
                    String location = requiredField(fields, "location");
                    if (!location.equals(asset.path("location").asText())) {
                        asset.put("location", location);
                        changed = true;
                    }
                }
                if (changed) lifecycle(asset, fields, "基础数据联动", requiredField(fields, "description"));
            }
            case "edit", "batch-edit" -> {
                Set<String> forbiddenWorkflowFields = Set.of(
                    "owner", "ownerSubject", "receiveDate", "borrowDate", "returnDate", "expectedReturnDate",
                    "handoverDate", "handoverType", "status", "condition", "lifecycle", "operationHistory");
                Set<String> suppliedForbiddenFields = forbiddenWorkflowFields.stream()
                    .filter(fields::has)
                    .collect(java.util.stream.Collectors.toCollection(LinkedHashSet::new));
                if (!suppliedForbiddenFields.isEmpty()) {
                    throw new IllegalArgumentException(
                        "Workflow fields must be changed through a dedicated asset command: " + suppliedForbiddenFields);
                }
                Set<String> allowed = Set.of("company", "companyUnionId", "department", "departmentUnionId",
                    "name", "category", "type", "custodian", "brand", "model", "ownerCompany",
                    "location", "price", "purchaseDate", "purchaseMethod", "orderNo", "unit", "rent", "note");
                allowed.forEach(field -> { if (fields.has(field)) asset.set(field, fields.get(field)); });
                if (fields.has("category")) {
                    String category = requiredField(fields, "category");
                    asset.put("category", category);
                    asset.put("type", category);
                }
                if (fields.has("location")) asset.put("location", requiredField(fields, "location"));
                lifecycle(asset, fields, "batch-edit".equals(action) ? "批量修改" : "资产编辑", "通过管理端更新资产信息");
            }
            default -> throw new IllegalArgumentException("Unsupported asset action: " + action);
        }
    }

    private boolean isImportAction(String action) {
        return "update-import".equals(action) || "receive-import".equals(action);
    }

    private void recordInitialOperations(JsonNode created, Actor actor) {
        ObjectNode asset = (ObjectNode) created;
        ObjectNode inboundFields = mapper.createObjectNode();
        inboundFields.put("date", date(asset.path("purchaseDate").asText()));
        putActor(inboundFields, actor);
        inboundFields.put("note", asset.path("note").asText(""));
        operationRepository.create(buildOperation(asset, null, inboundFields,
            "INBOUND", "ZCRK", "已完成"));
        if (!asset.path("ownerSubject").asText("").isBlank()) {
            ObjectNode assignmentFields = inboundFields.deepCopy();
            assignmentFields.put("receiver", asset.path("owner").asText());
            assignmentFields.put("receiverSubject", asset.path("ownerSubject").asText());
            String status = asset.path("status").asText();
            if ("借用中".equals(status)) {
                assignmentFields.put("date", date(asset.path("borrowDate").asText()));
                ObjectNode operation = buildOperation(asset, null, assignmentFields,
                    "BORROW", "JY", "待归还");
                operation.put("returnOrderId", operationId("GH", operation.path("date").asText()));
                operationRepository.create(operation);
            } else if ("交接待签字".equals(status)) {
                assignmentFields.put("date", date(asset.path("handoverDate").asText()));
                operationRepository.create(buildOperation(asset, null, assignmentFields,
                    "HANDOVER", "JJ", "待签字"));
            } else {
                assignmentFields.put("date", date(asset.path("receiveDate").asText()));
                operationRepository.create(buildOperation(asset, null, assignmentFields,
                    "RECEIVE", "LY", "已完成"));
            }
        }
    }

    @Transactional
    public int backfillMissingOperationHistory() {
        int migrated = 0;
        for (JsonNode asset : repository.findAll()) {
            String assetId = asset.path("id").asText("").trim();
            if (!assetId.isEmpty() && !operationRepository.existsForAsset(assetId)) {
                recordInitialOperations(asset, Actor.SYSTEM);
                migrated++;
            }
        }
        return migrated;
    }

    private void recordCommandOperations(String action, Map<String, ObjectNode> after,
                                         Map<String, ObjectNode> before, JsonNode fields,
                                         Map<String, JsonNode> importOperations) {
        after.forEach((assetId, asset) -> {
            JsonNode commandFields = isImportAction(action)
                ? importOperations.get(assetId)
                : fields == null ? mapper.createObjectNode() : fields;
            String effectiveAction = "receive-import".equals(action) ? "receive" : action;
            ObjectNode previous = before.get(assetId);
            switch (effectiveAction) {
                case "receive" -> operationRepository.create(buildOperation(
                    asset, previous, commandFields, "RECEIVE", "LY",
                    "领用待签字".equals(asset.path("status").asText()) ? "待签字" : "已完成"));
                case "return" -> operationRepository.create(buildOperation(
                    asset, previous, commandFields, "RETURN", "TK", "已完成"));
                case "borrow" -> {
                    ObjectNode operation = buildOperation(asset, previous, commandFields, "BORROW", "JY",
                        "借用待签字".equals(asset.path("status").asText()) ? "待签字" : "待归还");
                    operation.put("returnOrderId", operationId("GH", operation.path("date").asText()));
                    operationRepository.create(operation);
                }
                case "borrow-return" -> {
                    ObjectNode borrowOperation = operationRepository.updateLatest(assetId, "BORROW", Set.of("待归还"), operation -> {
                        operation.put("status", "已归还");
                        operation.put("returnedAt", date(commandFields.path("date").asText()));
                    });
                    ObjectNode returnOperation = buildOperation(
                        asset, previous, commandFields, "BORROW_RETURN", "GH", "已完成");
                    returnOperation.put("id", borrowOperation.path("returnOrderId").asText(returnOperation.path("id").asText()));
                    operationRepository.create(returnOperation);
                }
                case "handover" -> operationRepository.create(buildOperation(
                    asset, previous, commandFields, "HANDOVER", "JJ",
                    "交接待签字".equals(asset.path("status").asText()) ? "待签字" : "已完成"));
                case "handover-sign" -> operationRepository.updateLatest(
                    assetId, "HANDOVER", Set.of("待签字"), operation -> {
                        operation.put("status", "已完成");
                        operation.put("signedAt", date(commandFields.path("date").asText()));
                        operation.put("signerSubject", commandFields.path("operatorSubject").asText());
                    });
                case "handover-cancel" -> updatePendingHandoverOperation(
                    assetId, commandFields, operation -> {
                        operation.put("status", "已取消");
                        operation.put("cancelledAt", date(commandFields.path("date").asText()));
                        operation.put("cancelledBy", commandFields.path("operator").asText());
                    });
                case "handover-reject" -> updatePendingHandoverOperation(
                    assetId, commandFields, operation -> {
                        operation.put("status", "已打回");
                        operation.put("rejectedAt", date(commandFields.path("date").asText()));
                        operation.put("rejectedBy", commandFields.path("operator").asText());
                        operation.put("rejectionReason", commandFields.path("reason").asText());
                    });
                case "receipt-sign" -> updateReceiptOperation(assetId, previous.path("status").asText(), Set.of("待签字"), operation -> {
                    operation.put("status", "BORROW".equals(operation.path("type").asText()) ? "待归还" : "已签字");
                    operation.put("signedAt", java.time.Instant.now().toString());
                    operation.put("signer", commandFields.path("operator").asText());
                    operation.put("signerSubject", commandFields.path("operatorSubject").asText());
                    operation.put("signatureImage", commandFields.path("signatureImage").asText());
                });
                case "receipt-reject" -> updateReceiptOperation(assetId, previous.path("status").asText(), Set.of("待签字"), operation -> {
                    operation.put("status", "已打回");
                    operation.put("rejectedAt", java.time.Instant.now().toString());
                    operation.put("rejectedBy", commandFields.path("operator").asText());
                    operation.put("rejectionReason", commandFields.path("reason").asText());
                });
                case "receipt-cancel" -> updateReceiptOperation(assetId, previous.path("status").asText(), Set.of("待签字"), operation -> {
                    operation.put("status", "已终止");
                    operation.put("cancelledAt", java.time.Instant.now().toString());
                    operation.put("cancelledBy", commandFields.path("operator").asText());
                });
                case "borrow-delay" -> operationRepository.updateLatest(
                    assetId, "BORROW", Set.of("待归还"), operation -> {
                        operation.put("expectedReturnDate", asset.path("expectedReturnDate").asText());
                        operation.put("updatedAt", java.time.Instant.now().toString());
                    });
                case "repair-start", "repair-complete", "disposal-start", "disposal-complete", "disposal-cancel" -> {
                    // Repair state is represented by the repair business record and asset audit log.
                }
                case "cancel-inbound" -> operationRepository.updateLatest(
                    assetId, "INBOUND", Set.of("已完成"), operation -> {
                        operation.put("status", "已取消");
                        operation.put("cancelledAt", date(commandFields.path("date").asText()));
                    });
                default -> {
                    // Metadata edits do not create lifecycle orders.
                }
            }
        });
    }

    private ObjectNode buildOperation(ObjectNode asset, ObjectNode previous, JsonNode fields,
                                      String type, String prefix, String status) {
        String operationDate = date(fields.path("date").asText(asset.path("purchaseDate").asText()));
        ObjectNode operation = mapper.createObjectNode();
        operation.put("id", operationId(prefix, operationDate));
        operation.put("createdAt", java.time.Instant.now().toString());
        operation.put("assetId", asset.path("id").asText());
        operation.put("type", type);
        operation.put("status", status);
        operation.put("date", operationDate);
        operation.put("operator", fields.path("operator").asText(asset.path("custodian").asText("系统")));
        operation.put("operatorSubject", fields.path("operatorSubject").asText(""));
        operation.put("party", operationParty(type, asset, previous));
        operation.put("partySubject", operationPartySubject(type, asset, previous));
        operation.put("previousParty", previous == null ? "" : previous.path("owner").asText(""));
        operation.put("previousPartySubject", previous == null ? "" : previous.path("ownerSubject").asText(""));
        if ("HANDOVER".equals(type)) {
            operation.put("handoverType", fields.path("handoverType").asText(asset.path("handoverType").asText("")));
            operation.put("previousCompany", previous == null ? "" : previous.path("company").asText(""));
            operation.put("previousDepartment", previous == null ? "" : previous.path("department").asText(""));
            operation.put("previousLocation", previous == null ? "" : previous.path("location").asText(""));
            operation.put("assetOwnerCompany", asset.path("ownerCompany").asText(asset.path("company").asText("")));
        }
        JsonNode usageSource = Set.of("RETURN", "BORROW_RETURN").contains(type) && previous != null
            ? previous : asset;
        operation.put("company", usageSource.path("company").asText(""));
        operation.put("department", usageSource.path("department").asText(""));
        operation.put("location", asset.path("location").asText(""));
        operation.put("note", fields.path("note").asText(asset.path("note").asText("")));
        operation.put("expectedReturnDate", asset.path("expectedReturnDate").asText(""));
        operation.put("assetName", asset.path("name").asText(""));
        operation.put("assetCategory", asset.path("category").asText(""));
        operation.put("assetBrand", asset.path("brand").asText(""));
        operation.put("assetModel", asset.path("model").asText(""));
        operation.put("assetSn", asset.path("sn").asText(""));
        operation.put("assetPrice", asset.path("price").asDouble(0));
        operation.put("noticeContent", workflowPolicy.noticeContent(
            type, fields.path("selfServiceRequest").asBoolean(false)));
        return operation;
    }

    private void updateReceiptOperation(String assetId, String pendingStatus, Set<String> statuses,
                                        java.util.function.Consumer<ObjectNode> mutation) {
        operationRepository.updateLatest(assetId, receiptType(pendingStatus), statuses, mutation);
    }

    private void updatePendingHandoverOperation(String assetId, JsonNode fields,
                                                java.util.function.Consumer<ObjectNode> mutation) {
        String operationId = fields.path("operationId").asText("").trim();
        if (operationId.isBlank()) {
            operationRepository.updateLatest(assetId, "HANDOVER", Set.of("待签字"), mutation);
        } else {
            operationRepository.update(operationId, assetId, "HANDOVER", Set.of("待签字"), mutation);
        }
    }

    private String receiptType(String status) {
        return switch (status) {
            case "领用待签字" -> "RECEIVE";
            case "借用待签字" -> "BORROW";
            case "交接待签字" -> "HANDOVER";
            default -> throw new IllegalArgumentException("Asset is not waiting for employee signature");
        };
    }

    private void completeReceipt(ObjectNode asset, JsonNode fields) {
        String type = receiptType(asset.path("status").asText());
        requireDesignatedRecipient(asset, fields);
        String signatureImage = fields.path("signatureImage").asText("").trim();
        if (!signatureImage.matches("^data:image/(png|jpeg);base64,[A-Za-z0-9+/=]+$") || signatureImage.length() > 700_000) {
            throw new IllegalArgumentException("A valid PNG or JPEG signature image is required");
        }
        asset.put("status", "BORROW".equals(type) ? "借用中" : "领用");
        lifecycle(asset, fields, "员工签收", asset.path("owner").asText("接收人") + " 已签字确认");
        clearReceiptSnapshot(asset);
    }

    private void rejectReceipt(ObjectNode asset, JsonNode fields, boolean cancelledByAdministrator) {
        receiptType(asset.path("status").asText());
        if (!cancelledByAdministrator) {
            requireDesignatedRecipient(asset, fields);
            requiredField(fields, "reason");
        }
        restoreReceiptSnapshot(asset);
        lifecycle(asset, fields, cancelledByAdministrator ? "终止签收" : "签收打回",
            cancelledByAdministrator
                ? requiredField(fields, "operator") + " 终止待签收单"
                : requiredField(fields, "operator") + " 打回待签收单");
        clearReceiptSnapshot(asset);
    }

    private void cancelPendingHandover(ObjectNode asset, JsonNode fields, boolean rejectedByReceiver) {
        ObjectNode operation = pendingHandoverOperation(asset, fields);
        if (rejectedByReceiver) {
            String receiverSubject = operation.path("partySubject").asText("").trim();
            String operatorSubject = fields.path("operatorSubject").asText("").trim();
            if (receiverSubject.isBlank() || operatorSubject.isBlank() || !receiverSubject.equals(operatorSubject)) {
                throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                    "Only the designated handover receiver can reject this handover");
            }
        }
        if (!isCurrentPendingHandover(asset, operation)) return;

        restoreReceiptSnapshot(asset);
        lifecycle(asset, fields, rejectedByReceiver ? "交接打回" : "取消交接",
            rejectedByReceiver
                ? requiredField(fields, "operator") + " 打回交接单"
                : requiredField(fields, "operator") + " 取消交接单");
        clearReceiptSnapshot(asset);
    }

    private ObjectNode pendingHandoverOperation(ObjectNode asset, JsonNode fields) {
        String operationId = fields.path("operationId").asText("").trim();
        ObjectNode operation = operationId.isBlank()
            ? operationRepository.findLatest(asset.path("id").asText(), "HANDOVER", Set.of("待签字"))
            : operationRepository.find(operationId);
        if (!asset.path("id").asText().equals(operation.path("assetId").asText())
            || !"HANDOVER".equals(operation.path("type").asText())
            || !"待签字".equals(operation.path("status").asText())) {
            throw new IllegalStateException("Asset handover is no longer waiting for signature");
        }
        return operation;
    }

    private boolean isCurrentPendingHandover(ObjectNode asset, ObjectNode operation) {
        return "交接待签字".equals(asset.path("status").asText())
            && asset.path("ownerSubject").asText("").equals(operation.path("partySubject").asText(""))
            && asset.has("handoverPreviousStatus")
            && asset.has("handoverPreviousOwner")
            && asset.has("handoverPreviousOwnerSubject");
    }

    private void rejectWorkflowChangesDuringPendingSignature(JsonNode previous, ObjectNode replacement) {
        if (previous == null || !PENDING_SIGNATURE_STATUSES.contains(previous.path("status").asText())) return;
        Set<String> protectedFields = Set.of("owner", "ownerSubject", "company", "companyUnionId", "department",
            "departmentUnionId", "location", "status", "receiveDate", "borrowDate", "expectedReturnDate",
            "handoverDate", "handoverType");
        boolean changed = protectedFields.stream()
            .anyMatch(field -> !previous.path(field).asText("").equals(replacement.path(field).asText("")));
        if (changed) {
            throw new IllegalArgumentException("Asset is waiting for employee signature and cannot be changed by catalog replacement: "
                + previous.path("id").asText());
        }
    }

    private void requireDesignatedRecipient(ObjectNode asset, JsonNode fields) {
        String receiverSubject = asset.path("ownerSubject").asText("").trim();
        String operatorSubject = fields.path("operatorSubject").asText("").trim();
        if (receiverSubject.isBlank() || operatorSubject.isBlank() || !receiverSubject.equals(operatorSubject)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                "Only the designated recipient can process this receipt");
        }
    }

    private String operationParty(String type, ObjectNode asset, ObjectNode previous) {
        return switch (type) {
            case "RETURN", "BORROW_RETURN" -> previous == null ? "" : previous.path("owner").asText("");
            default -> asset.path("owner").asText("");
        };
    }

    private String operationPartySubject(String type, ObjectNode asset, ObjectNode previous) {
        return switch (type) {
            case "RETURN", "BORROW_RETURN" -> previous == null ? "" : previous.path("ownerSubject").asText("");
            default -> asset.path("ownerSubject").asText("");
        };
    }

    private String operationId(String prefix, String value) {
        String compactDate = date(value).replace("-", "");
        String suffix = java.util.UUID.randomUUID().toString().replace("-", "").substring(0, 10).toUpperCase();
        return prefix + compactDate + suffix;
    }

    private Map<String, JsonNode> importOperations(Set<String> assetIds, JsonNode fields) {
        JsonNode operations = fields == null ? null : fields.get("operations");
        if (operations == null || !operations.isObject()) {
            throw new IllegalArgumentException("Asset import command requires an operations object");
        }
        Set<String> operationIds = new LinkedHashSet<>();
        operations.fieldNames().forEachRemaining(operationIds::add);
        if (!operationIds.equals(assetIds)) {
            Set<String> missing = new LinkedHashSet<>(assetIds);
            missing.removeAll(operationIds);
            Set<String> extra = new LinkedHashSet<>(operationIds);
            extra.removeAll(assetIds);
            throw new IllegalArgumentException("Asset import operations must exactly match asset ids; missing="
                + missing + ", extra=" + extra);
        }
        Map<String, JsonNode> result = new LinkedHashMap<>();
        assetIds.forEach(assetId -> {
            JsonNode operation = operations.get(assetId);
            if (operation == null || !operation.isObject()) {
                throw new IllegalArgumentException("Asset import operation must be an object: " + assetId);
            }
            result.put(assetId, operation);
        });
        return result;
    }

    @Transactional
    public int applyReferenceChanges(PortalReferenceCatalog.ReferenceChange change) {
        if (change == null || !change.applies()) return 0;
        repository.lockForWrite();
        List<JsonNode> assets = repository.findAll();
        int changed = 0;
        for (int index = 0; index < assets.size(); index++) {
            JsonNode source = assets.get(index);
            String current = source.path(change.field()).asText("").trim();
            if (change.removed().contains(current)) {
                throw new IllegalArgumentException("Cannot remove server catalog value referenced by asset "
                    + source.path("id").asText() + ": " + current);
            }
            String replacement = change.replacements().get(current);
            ObjectNode asset = (ObjectNode) source.deepCopy();
            if (replacement != null && !replacement.equals(current)) {
                asset.put(change.field(), replacement);
                if ("category".equals(change.field())) asset.put("type", replacement);
                ObjectNode fields = mapper.createObjectNode();
                fields.put("date", java.time.LocalDate.now().toString());
                lifecycle(asset, fields, "基础数据联动", ("category".equals(change.field()) ? "资产分类" : "所在位置")
                    + "由 " + current + " 更新为 " + replacement);
                assets.set(index, asset);
                current = replacement;
                changed++;
            }
            if (current.isBlank() || !change.allowedValues().contains(current)) {
                throw new IllegalArgumentException("Asset " + source.path("id").asText()
                    + " references a value outside the server catalog: " + current);
            }
        }
        if (changed > 0) replaceAll(assets);
        return changed;
    }

    private void requireStatus(ObjectNode asset, Set<String> allowed) {
        if (!allowed.contains(asset.path("status").asText())) throw new IllegalArgumentException("Asset is not eligible for this operation: " + asset.path("id").asText());
    }

    private void normalizeUnassignedUsage(JsonNode source) {
        if (source == null || !source.isObject() || !UNASSIGNED.contains(source.path("status").asText())) return;
        ObjectNode asset = (ObjectNode) source;
        asset.put("owner", "未分配");
        CURRENT_USAGE_FIELDS.forEach(field -> asset.put(field, ""));
        clearReceiptSnapshot(asset);
    }

    private void clearStaleWorkflowFields(ObjectNode asset, String status) {
        if (!"维修中".equals(status)) {
            asset.remove(List.of("repairPreviousStatus", "repairStartedAt"));
        }
        if (!Set.of("处置中", "已处置").contains(status)) {
            asset.remove(List.of("disposalPreviousStatus", "disposalId", "disposalStartedAt", "disposedAt"));
        }
        if (!Set.of("领用待签字", "借用待签字", "交接待签字").contains(status)) {
            clearReceiptSnapshot(asset);
        }
    }

    private void snapshotReceipt(ObjectNode asset) {
        snapshot(asset, "owner");
        snapshot(asset, "ownerSubject");
        snapshot(asset, "company");
        snapshot(asset, "companyUnionId");
        snapshot(asset, "department");
        snapshot(asset, "departmentUnionId");
        snapshot(asset, "location");
        snapshot(asset, "status");
        snapshot(asset, "receiveDate");
        snapshot(asset, "borrowDate");
        snapshot(asset, "expectedReturnDate");
    }

    private void snapshot(ObjectNode asset, String field) {
        asset.put("handoverPrevious" + Character.toUpperCase(field.charAt(0)) + field.substring(1),
            asset.path(field).asText(""));
    }

    private void restoreReceiptSnapshot(ObjectNode asset) {
        restore(asset, "owner", true);
        restore(asset, "ownerSubject", true);
        restore(asset, "company", false);
        restore(asset, "companyUnionId", false);
        restore(asset, "department", false);
        restore(asset, "departmentUnionId", false);
        restore(asset, "location", true);
        restore(asset, "status", true);
        restore(asset, "receiveDate", false);
        restore(asset, "borrowDate", false);
        restore(asset, "expectedReturnDate", false);
    }

    private void restore(ObjectNode asset, String field, boolean required) {
        String snapshotField = "handoverPrevious" + Character.toUpperCase(field.charAt(0)) + field.substring(1);
        if (required && !asset.has(snapshotField)) {
            throw new IllegalStateException("Handover snapshot is incomplete: " + snapshotField);
        }
        asset.put(field, asset.path(snapshotField).asText(""));
    }

    private void clearReceiptSnapshot(ObjectNode asset) {
        Set.of("Owner", "OwnerSubject", "Company", "CompanyUnionId", "Department", "DepartmentUnionId", "Location", "Status",
                "ReceiveDate", "BorrowDate", "ExpectedReturnDate")
            .forEach(field -> asset.remove("handoverPrevious" + field));
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

    private String normalizeReplacementStatus(String value) {
        return switch (value) {
            case "在用", "领用中" -> "领用";
            case "借用" -> "借用中";
            case "领用审批中", "交接审批中", "退库审批中" -> "审批中";
            default -> value;
        };
    }

    private void lifecycle(ObjectNode asset, JsonNode fields, String action, String description) {
        ArrayNode history = asset.path("lifecycle").isArray() ? (ArrayNode) asset.path("lifecycle") : mapper.createArrayNode();
        history.add(mapper.createArrayNode().add(date(fields.path("date").asText())).add(action).add(description));
        asset.set("lifecycle", history);
    }

    private void validate(JsonNode asset, JsonNode existing, Set<String> ids,
                          Set<String> allowedCategories, Set<String> allowedLocations) {
        if (asset == null || !asset.isObject()) throw new IllegalArgumentException("Every asset must be an object");
        String id = requiredText(asset, "id", 191);
        requiredText(asset, "name", 255);
        String category = requiredText(asset, "category", 128);
        String location = requiredText(asset, "location", 255);
        if (!allowedCategories.contains(category)) {
            throw new IllegalArgumentException("Asset category is not present in the server catalog: " + category);
        }
        if (!allowedLocations.contains(location)) {
            throw new IllegalArgumentException("Asset location is not present in the server catalog: " + location);
        }
        String owner = asset.path("owner").asText("").trim();
        if (!owner.isBlank() && !"未分配".equals(owner)) requiredText(asset, "ownerSubject", 191);
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
            case "空闲", "闲置", "上架", "待验收" -> Set.of(
                "领用", "借用中", "领用待签字", "借用待签字", "维修中", "审批中", "处置中", "已报废").contains(after);
            case "领用" -> Set.of("空闲", "闲置", "维修中", "审批中", "交接待签字", "已报废").contains(after);
            case "借用中" -> Set.of("空闲", "闲置", "维修中", "审批中", "交接待签字").contains(after);
            case "维修中" -> Set.of("空闲", "闲置", "领用", "借用中", "已报废").contains(after);
            case "审批中" -> Set.of("空闲", "闲置", "领用", "借用中", "已报废").contains(after);
            case "交接待签字" -> Set.of("领用", "借用中").contains(after);
            case "领用待签字" -> Set.of("空闲", "闲置", "上架", "待验收", "领用").contains(after);
            case "借用待签字" -> Set.of("空闲", "闲置", "上架", "待验收", "借用中").contains(after);
            case "处置中" -> Set.of("空闲", "已处置").contains(after);
            case "已处置" -> "空闲".equals(after);
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

    private void putActor(ObjectNode fields, Actor actor) {
        Actor value = actor == null ? Actor.SYSTEM : actor;
        fields.put("operator", value.name());
        fields.put("operatorAccount", value.account());
        fields.put("operatorSubject", value.subject());
    }

    public record Actor(String name, String account, String subject) {
        public static final Actor SYSTEM = new Actor("系统", "", "");

        public Actor {
            name = name == null || name.isBlank() ? "系统" : name.trim();
            account = account == null ? "" : account.trim();
            subject = subject == null ? "" : subject.trim();
        }
    }
}
