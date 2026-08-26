package team.acg.access.assets.asset;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.annotation.PostConstruct;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

@Repository
public class AssetRepository {
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    public AssetRepository(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    @PostConstruct
    void initialize() {
        jdbc.execute("""
            CREATE TABLE IF NOT EXISTS asset_record (
              asset_id VARCHAR(191) PRIMARY KEY,
              status VARCHAR(32) NOT NULL,
              document LONGTEXT NOT NULL,
              version BIGINT NOT NULL,
              updated_at TIMESTAMP(3) NOT NULL
            )
            """);
        jdbc.execute("""
            CREATE TABLE IF NOT EXISTS asset_audit_log (
              audit_id VARCHAR(36) PRIMARY KEY,
              asset_id VARCHAR(191) NOT NULL,
              action VARCHAR(64) NOT NULL,
              before_status VARCHAR(32),
              after_status VARCHAR(32),
              changed_at TIMESTAMP(3) NOT NULL
            )
            """);
        jdbc.execute("""
            CREATE TABLE IF NOT EXISTS asset_write_guard (
              guard_id INT PRIMARY KEY,
              version BIGINT NOT NULL
            )
            """);
        if (jdbc.queryForObject("SELECT COUNT(*) FROM asset_write_guard WHERE guard_id = 1", Integer.class) == 0) {
            try {
                jdbc.update("INSERT INTO asset_write_guard (guard_id, version) VALUES (1, 0)");
            } catch (DuplicateKeyException ignored) {
                // Another application instance initialized the guard concurrently.
            }
        }
    }

    public List<JsonNode> findAll() {
        return new ArrayList<>(findAllRecords().values().stream().map(AssetRecord::document).toList());
    }

    public List<JsonNode> findActive() {
        return jdbc.query(
            "SELECT document FROM asset_record WHERE status <> ? ORDER BY updated_at DESC, asset_id",
            (rs, row) -> read(rs.getString(1)), "已处置");
    }

    /** Migrate the former borrow label without changing any other asset fields. */
    public int normalizeLegacyBorrowStatuses(Instant now) {
        return jdbc.update(
            "UPDATE asset_record SET status = ?, document = REPLACE(document, ?, ?), "
                + "version = version + 1, updated_at = ? WHERE status = ?",
            "借用", "\"status\":\"借用中\"", "\"status\":\"借用\"", Timestamp.from(now), "借用中");
    }

    public long countByStatus(String status) {
        Long count = jdbc.queryForObject(
            "SELECT COUNT(*) FROM asset_record WHERE status = ?", Long.class, status);
        return count == null ? 0 : count;
    }

    public Map<String, AssetRecord> findAllRecords() {
        Map<String, AssetRecord> records = new LinkedHashMap<>();
        jdbc.query("SELECT asset_id, document, version FROM asset_record ORDER BY updated_at DESC, asset_id",
            (rs, row) -> Map.entry(rs.getString(1), new AssetRecord(read(rs.getString(2)), rs.getLong(3))))
            .forEach(entry -> records.put(entry.getKey(), entry.getValue()));
        return records;
    }

    public JsonNode find(String id) {
        List<JsonNode> rows = jdbc.query("SELECT document FROM asset_record WHERE asset_id = ?", (rs, row) -> read(rs.getString(1)), id);
        return rows.isEmpty() ? null : rows.get(0);
    }

    /** Applies a source-system snapshot while keeping the target record version monotonic. */
    public void upsertFromSync(JsonNode asset, Instant now) {
        String id = asset.path("id").asText("").trim();
        if (id.isEmpty()) throw new IllegalArgumentException("Synchronized asset has no id");
        List<Long> versions = jdbc.query("SELECT version FROM asset_record WHERE asset_id = ?", (rs, row) -> rs.getLong(1), id);
        if (versions.isEmpty()) {
            jdbc.update("INSERT INTO asset_record (asset_id, status, document, version, updated_at) VALUES (?, ?, ?, ?, ?)",
                id, asset.path("status").asText(), asset.toString(), 1L, Timestamp.from(now));
            return;
        }
        jdbc.update("UPDATE asset_record SET status = ?, document = ?, version = ?, updated_at = ? WHERE asset_id = ?",
            asset.path("status").asText(), asset.toString(), versions.get(0) + 1, Timestamp.from(now), id);
    }

    /** Removes records that do not belong to the configured source system. */
    public int removeAssetsOutsideSource(String sourceSystem) {
        List<String> removed = findAllRecords().entrySet().stream()
            .filter(entry -> !sourceSystem.equals(entry.getValue().document().path("sourceSystem").asText()))
            .map(Map.Entry::getKey)
            .toList();
        removed.forEach(id -> jdbc.update("DELETE FROM asset_record WHERE asset_id = ?", id));
        return removed.size();
    }

    /** Migrates source codes saved by earlier sync versions into the standard display field. */
    public int backfillLegacyAssetCodes(String sourceSystem, Instant now) {
        int updated = 0;
        for (Map.Entry<String, AssetRecord> entry : findAllRecords().entrySet()) {
            AssetRecord record = entry.getValue();
            JsonNode document = record.document();
            if (!sourceSystem.equals(document.path("sourceSystem").asText())
                || document.path("assetCode").asText("").trim().length() > 0) continue;
            String legacyAssetCode = document.path("legacyAssetCode").asText("").trim();
            if (legacyAssetCode.isEmpty() || !document.isObject()) continue;
            ObjectNode next = document.deepCopy();
            next.put("assetCode", legacyAssetCode);
            int changed = jdbc.update("UPDATE asset_record SET document = ?, version = ?, updated_at = ? WHERE asset_id = ? AND version = ?",
                next.toString(), record.version() + 1, Timestamp.from(now), entry.getKey(), record.version());
            if (changed != 1) throw conflict(entry.getKey());
            updated++;
        }
        return updated;
    }

    /** Reconciles a completed source snapshot, removing local and stale source records. */
    public int reconcileSourceSnapshot(String sourceSystem, Set<String> sourceAssetIds) {
        List<String> removed = findAllRecords().entrySet().stream()
            .filter(entry -> !sourceSystem.equals(entry.getValue().document().path("sourceSystem").asText())
                || !sourceAssetIds.contains(entry.getKey()))
            .map(Map.Entry::getKey)
            .toList();
        removed.forEach(id -> jdbc.update("DELETE FROM asset_record WHERE asset_id = ?", id));
        return removed.size();
    }

    public void lockForWrite() {
        jdbc.queryForObject("SELECT version FROM asset_write_guard WHERE guard_id = 1 FOR UPDATE", Long.class);
    }

    public void replaceAll(List<JsonNode> assets, Map<String, AssetRecord> existing, Instant now) {
        Map<String, JsonNode> next = assets.stream().collect(Collectors.toMap(
            asset -> asset.path("id").asText(), asset -> asset, (left, right) -> {
                throw new IllegalArgumentException("Duplicate asset id: " + left.path("id").asText());
            }, LinkedHashMap::new));
        Set<String> removed = existing.keySet().stream().filter(id -> !next.containsKey(id)).collect(Collectors.toSet());
        for (String id : removed) {
            AssetRecord record = existing.get(id);
            int deleted = jdbc.update("DELETE FROM asset_record WHERE asset_id = ? AND version = ?", id, record.version());
            if (deleted != 1) throw conflict(id);
        }
        next.forEach((id, asset) -> {
            AssetRecord record = existing.get(id);
            if (record == null) {
                try {
                    jdbc.update("INSERT INTO asset_record (asset_id, status, document, version, updated_at) VALUES (?, ?, ?, ?, ?)",
                        id, asset.path("status").asText(), asset.toString(), 1L, Timestamp.from(now));
                } catch (DuplicateKeyException error) {
                    throw conflict(id);
                }
                return;
            }
            if (record.document().equals(asset)) return;
            int updated = jdbc.update("UPDATE asset_record SET status = ?, document = ?, version = ?, updated_at = ? "
                    + "WHERE asset_id = ? AND version = ?",
                asset.path("status").asText(), asset.toString(), record.version() + 1, Timestamp.from(now), id, record.version());
            if (updated != 1) throw conflict(id);
        });
    }

    public void appendAudit(String assetId, String action, String beforeStatus, String afterStatus, Instant now) {
        jdbc.update("INSERT INTO asset_audit_log (audit_id, asset_id, action, before_status, after_status, changed_at) VALUES (?, ?, ?, ?, ?, ?)",
            java.util.UUID.randomUUID().toString(), assetId, action, beforeStatus, afterStatus, Timestamp.from(now));
    }

    public int deleteAuditHistory() {
        return jdbc.update("DELETE FROM asset_audit_log");
    }

    private JsonNode read(String value) {
        try {
            return mapper.readTree(value);
        } catch (Exception error) {
            throw new IllegalStateException("Asset document is invalid", error);
        }
    }

    private AssetVersionConflictException conflict(String id) {
        return new AssetVersionConflictException("Asset was modified concurrently: " + id);
    }

    public record AssetRecord(JsonNode document, long version) {}
}
