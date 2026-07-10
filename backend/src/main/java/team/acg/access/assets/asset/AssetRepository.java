package team.acg.access.assets.asset;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;

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
    }

    public List<JsonNode> findAll() {
        return jdbc.query("SELECT document FROM asset_record ORDER BY updated_at DESC, asset_id", (rs, row) -> read(rs.getString(1)));
    }

    public JsonNode find(String id) {
        List<JsonNode> rows = jdbc.query("SELECT document FROM asset_record WHERE asset_id = ?", (rs, row) -> read(rs.getString(1)), id);
        return rows.isEmpty() ? null : rows.getFirst();
    }

    public void replaceAll(List<JsonNode> assets, Instant now) {
        jdbc.update("DELETE FROM asset_record");
        assets.forEach(asset -> jdbc.update(
            "INSERT INTO asset_record (asset_id, status, document, version, updated_at) VALUES (?, ?, ?, ?, ?)",
            asset.path("id").asText(), asset.path("status").asText(), asset.toString(), 1L, Timestamp.from(now)));
    }

    public void appendAudit(String assetId, String action, String beforeStatus, String afterStatus, Instant now) {
        jdbc.update("INSERT INTO asset_audit_log (audit_id, asset_id, action, before_status, after_status, changed_at) VALUES (?, ?, ?, ?, ?, ?)",
            java.util.UUID.randomUUID().toString(), assetId, action, beforeStatus, afterStatus, Timestamp.from(now));
    }

    private JsonNode read(String value) {
        try {
            return mapper.readTree(value);
        } catch (Exception error) {
            throw new IllegalStateException("Asset document is invalid", error);
        }
    }
}
