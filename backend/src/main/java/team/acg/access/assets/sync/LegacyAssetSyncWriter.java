package team.acg.access.assets.sync;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Service;
import team.acg.access.assets.asset.AssetRepository;

import java.time.Instant;

@Service
public class LegacyAssetSyncWriter {
    private final AssetRepository assets;
    private final ObjectMapper mapper;

    LegacyAssetSyncWriter(AssetRepository assets, ObjectMapper mapper) {
        this.assets = assets;
        this.mapper = mapper;
    }

    void upsert(JsonNode source, Instant syncedAt) {
        ObjectNode mapped = map(source, syncedAt);
        JsonNode previous = assets.find(mapped.path("id").asText());
        ObjectNode next = previous != null && previous.isObject() ? (ObjectNode) previous.deepCopy() : mapper.createObjectNode();
        mapped.fields().forEachRemaining(field -> next.set(field.getKey(), field.getValue()));
        if (!next.has("lifecycle")) next.set("lifecycle", mapper.createArrayNode());
        assets.upsertFromSync(next, syncedAt);
        String before = previous == null ? "" : previous.path("status").asText("");
        String after = next.path("status").asText("");
        if (previous == null || !before.equals(after)) assets.appendAudit(next.path("id").asText(), "LEGACY_SYNC", before, after, syncedAt);
    }

    void markDeleted(long sourceAssetId, String assetCode, Instant syncedAt) {
        String targetId = targetId(sourceAssetId);
        JsonNode current = assets.find(targetId);
        ObjectNode asset = current != null && current.isObject() ? (ObjectNode) current.deepCopy() : mapper.createObjectNode();
        asset.put("id", targetId);
        if (!asset.hasNonNull("name")) asset.put("name", assetCode == null || assetCode.isBlank() ? targetId : assetCode);
        if (!asset.hasNonNull("category")) asset.put("category", "未分类");
        asset.put("type", asset.path("category").asText("未分类"));
        asset.put("status", "已处置");
        asset.put("legacyStatusDisplay", "已处置（老系统已删除）");
        asset.put("legacyStatusKind", "SOURCE_DELETED");
        asset.put("legacyStatusVerified", true);
        asset.put("sourceDeleted", true);
        asset.put("sourceSystem", "bear-rental-ams");
        asset.put("legacyAssetId", sourceAssetId);
        String normalizedAssetCode = assetCode == null ? "" : assetCode.trim();
        asset.put("assetCode", normalizedAssetCode);
        asset.put("legacyAssetCode", normalizedAssetCode);
        asset.put("syncedAt", syncedAt.toString());
        if (!asset.has("lifecycle")) asset.set("lifecycle", mapper.createArrayNode());
        assets.upsertFromSync(asset, syncedAt);
    }

    private ObjectNode map(JsonNode source, Instant syncedAt) {
        long sourceAssetId = source.path("assetId").asLong(0);
        if (sourceAssetId <= 0) throw new IllegalArgumentException("Legacy asset detail has no assetId");
        ObjectNode asset = mapper.createObjectNode();
        asset.put("id", targetId(sourceAssetId));
        asset.put("legacyAssetId", sourceAssetId);
        String assetCode = source.path("assetCode").asText("").trim();
        asset.put("assetCode", assetCode);
        asset.put("legacyAssetCode", assetCode);
        asset.put("sourceSystem", "bear-rental-ams");
        asset.put("sourceDeleted", false);
        asset.put("name", textOr(source, "assetName", "资产-" + sourceAssetId));
        String category = textOr(source, "assetsCategoryName", "未分类");
        asset.put("category", category);
        asset.put("type", category);
        StatusState status = status(source);
        asset.put("status", status.operationalStatus());
        asset.put("legacyStatusDisplay", status.displayStatus());
        asset.put("legacyStatusKind", status.kind());
        asset.put("legacyStatusVerified", status.verified());
        asset.put("brand", textOr(source, "brand", ""));
        asset.put("model", textOr(source, "model", ""));
        asset.put("sn", textOr(source, "assetSequenceNo", ""));
        asset.put("owner", textOr(source, "employeeName", "未分配"));
        asset.put("ownerSubject", "");
        asset.put("department", textOr(source, "departmentName", ""));
        asset.put("company", textOr(source, "useCompanyName", ""));
        asset.put("ownerCompany", textOr(source, "belongCompanyName", ""));
        asset.put("location", textOr(source, "placeName", ""));
        asset.put("custodian", textOr(source, "managerUserName", "系统同步"));
        asset.put("supplier", textOr(source, "supplierName", ""));
        asset.set("price", source.has("amount") ? source.get("amount") : mapper.getNodeFactory().numberNode(0));
        asset.set("rent", source.has("rentAmount") ? source.get("rentAmount") : mapper.getNodeFactory().numberNode(0));
        asset.put("note", textOr(source, "remark", ""));
        asset.put("legacyUseStatus", source.path("useStatus").asInt(0));
        asset.put("legacyAssetStatus", source.path("assetStatus").asInt(0));
        if (source.hasNonNull("quoteStatus")) asset.put("legacyQuoteStatus", source.path("quoteStatus").asInt());
        else asset.putNull("legacyQuoteStatus");
        // Keep the vendor response intact so undocumented status fields remain auditable.
        asset.set("legacySourcePayload", source.deepCopy());
        asset.put("syncedAt", syncedAt.toString());
        JsonNode extendInfo = source.get("extendInfo");
        if (extendInfo != null) asset.set("legacyExtendInfo", extendInfo);
        return asset;
    }

    private String textOr(JsonNode source, String field, String fallback) {
        String value = source.path(field).asText("").trim();
        return value.isEmpty() ? fallback : value;
    }

    private StatusState status(JsonNode source) {
        int assetStatus = source.path("assetStatus").asInt(0);
        int useStatus = source.path("useStatus").asInt(0);
        if (source.hasNonNull("quoteStatus")) {
            String workflow = switch (source.path("quoteStatus").asInt()) {
                case 1 -> "交接中";
                case 2 -> "退还中";
                case 3 -> "领用中";
                case 4 -> "借用中";
                default -> "状态待确认";
            };
            boolean verified = !"状态待确认".equals(workflow);
            String display = verified
                ? workflow + "（老系统状态码 " + assetStatus + "）"
                : "状态待确认（老系统状态码 " + assetStatus + "，单据状态码 "
                    + source.path("quoteStatus").asInt() + "）";
            return new StatusState(verified ? "流程中" : "状态待确认", display,
                verified ? "WORKFLOW" : "UNMAPPED", verified);
        }
        return switch (assetStatus) {
            // The legacy web client defines assetStatus=1 as idle. useStatus is the
            // condition (normal/fault/repair), not the lifecycle status.
            case 1 -> stableStatus("空闲");
            case 5 -> stableStatus("领用");
            case 6 -> stableStatus("领用审批中");
            case 7 -> stableStatus("领用待签字");
            case 8 -> stableStatus("退库审批中");
            case 9 -> stableStatus("借用");
            case 10 -> stableStatus("借用审批中");
            case 11 -> stableStatus("借用待签字");
            case 13 -> stableStatus("调拨中");
            case 14 -> stableStatus("调拨待签字");
            case 15 -> stableStatus("处置中");
            case 17 -> stableStatus("已处置");
            case 21 -> stableStatus("维修中");
            case 22 -> stableStatus("维修待签字");
            case 23 -> stableStatus("归还审批中");
            case 24 -> stableStatus("交接审批中");
            case 25 -> stableStatus("交接待签字");
            case 26 -> stableStatus("维修审批中");
            default -> switch (useStatus) {
                case 2, 3, 4 -> stableStatus("维修中");
                case 5, 6 -> stableStatus("处置中");
                default -> new StatusState("状态待确认", "状态待确认（老系统状态码 " + assetStatus + "）",
                    "UNMAPPED", false);
            };
        };
    }

    private StatusState stableStatus(String value) {
        return new StatusState(value, value, "STABLE", true);
    }

    private String targetId(long sourceAssetId) { return "legacy-asset-" + sourceAssetId; }

    private record StatusState(String operationalStatus, String displayStatus, String kind, boolean verified) {}
}
