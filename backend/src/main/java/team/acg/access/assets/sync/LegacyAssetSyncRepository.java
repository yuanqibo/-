package team.acg.access.assets.sync;

import jakarta.annotation.PostConstruct;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@Repository
public class LegacyAssetSyncRepository {
    private static final String SYNC_CODE = "legacy-asset";
    private final JdbcTemplate jdbc;

    LegacyAssetSyncRepository(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    @PostConstruct
    void initialize() {
        jdbc.execute("""
            CREATE TABLE IF NOT EXISTS legacy_asset_sync_state (
              sync_code VARCHAR(64) PRIMARY KEY,
              cursor_time TIMESTAMP(3) NULL,
              updated_at TIMESTAMP(3) NOT NULL
            )
            """);
        jdbc.execute("""
            CREATE TABLE IF NOT EXISTS legacy_asset_sync_run (
              run_id VARCHAR(36) PRIMARY KEY,
              sync_code VARCHAR(64) NOT NULL,
              window_start TIMESTAMP(3) NOT NULL,
              window_end TIMESTAMP(3) NOT NULL,
              status VARCHAR(16) NOT NULL,
              fetched_count INT NOT NULL,
              applied_count INT NOT NULL,
              failed_count INT NOT NULL,
              error_message VARCHAR(2048),
              started_at TIMESTAMP(3) NOT NULL,
              completed_at TIMESTAMP(3) NULL,
              INDEX idx_legacy_sync_run_started (sync_code, started_at)
            )
            """);
        jdbc.execute("""
            CREATE TABLE IF NOT EXISTS legacy_asset_sync_event (
              event_key VARCHAR(191) PRIMARY KEY,
              source_asset_id VARCHAR(64) NOT NULL,
              change_type INT NOT NULL,
              payload_hash VARCHAR(64) NOT NULL,
              run_id VARCHAR(36) NOT NULL,
              processed_at TIMESTAMP(3) NOT NULL
            )
            """);
        jdbc.execute("""
            CREATE TABLE IF NOT EXISTS legacy_asset_sync_dead_letter (
              dead_letter_id VARCHAR(36) PRIMARY KEY,
              event_key VARCHAR(191) NOT NULL,
              source_asset_id VARCHAR(64) NOT NULL,
              error_message VARCHAR(2048) NOT NULL,
              retry_count INT NOT NULL,
              status VARCHAR(16) NOT NULL,
              created_at TIMESTAMP(3) NOT NULL,
              updated_at TIMESTAMP(3) NOT NULL,
              INDEX idx_legacy_sync_dlq_status (status, updated_at)
            )
            """);
        jdbc.execute("""
            CREATE TABLE IF NOT EXISTS legacy_asset_sync_lock (
              lock_id VARCHAR(64) PRIMARY KEY,
              owner_id VARCHAR(64) NOT NULL,
              locked_until TIMESTAMP(3) NOT NULL
            )
            """);
    }

    boolean tryAcquireLock(String ownerId, Instant expiresAt) {
        Instant now = Instant.now();
        int updated = jdbc.update("UPDATE legacy_asset_sync_lock SET owner_id = ?, locked_until = ? WHERE lock_id = ? AND (locked_until < ? OR owner_id = ?)",
            ownerId, Timestamp.from(expiresAt), SYNC_CODE, Timestamp.from(now), ownerId);
        if (updated == 1) return true;
        try {
            jdbc.update("INSERT INTO legacy_asset_sync_lock (lock_id, owner_id, locked_until) VALUES (?, ?, ?)",
                SYNC_CODE, ownerId, Timestamp.from(expiresAt));
            return true;
        } catch (org.springframework.dao.DuplicateKeyException ignored) {
            return false;
        }
    }

    void releaseLock(String ownerId) {
        jdbc.update("UPDATE legacy_asset_sync_lock SET locked_until = ? WHERE lock_id = ? AND owner_id = ?",
            Timestamp.from(Instant.now().minusSeconds(1)), SYNC_CODE, ownerId);
    }

    Optional<Instant> cursor() {
        return jdbc.query("SELECT cursor_time FROM legacy_asset_sync_state WHERE sync_code = ?",
            rs -> rs.next() && rs.getTimestamp(1) != null
                ? Optional.of(rs.getTimestamp(1).toInstant()) : Optional.empty(), SYNC_CODE);
    }

    Map<String, Object> status() {
        Map<String, Object> value = new LinkedHashMap<>();
        cursor().ifPresent(item -> value.put("cursorTime", item.toString()));
        jdbc.query("SELECT run_id, status, fetched_count, applied_count, failed_count, window_start, window_end, started_at, completed_at, error_message "
                + "FROM legacy_asset_sync_run WHERE sync_code = ? ORDER BY started_at DESC LIMIT 1",
            rs -> {
                if (!rs.next()) return;
                value.put("runId", rs.getString("run_id"));
                value.put("status", rs.getString("status"));
                value.put("fetchedCount", rs.getInt("fetched_count"));
                value.put("appliedCount", rs.getInt("applied_count"));
                value.put("failedCount", rs.getInt("failed_count"));
                value.put("windowStart", rs.getTimestamp("window_start").toInstant().toString());
                value.put("windowEnd", rs.getTimestamp("window_end").toInstant().toString());
                value.put("startedAt", rs.getTimestamp("started_at").toInstant().toString());
                if (rs.getTimestamp("completed_at") != null) value.put("completedAt", rs.getTimestamp("completed_at").toInstant().toString());
                if (rs.getString("error_message") != null) value.put("errorMessage", rs.getString("error_message"));
            }, SYNC_CODE);
        return value;
    }

    List<Map<String, Object>> history(int limit) {
        int boundedLimit = Math.max(1, Math.min(limit, 100));
        return jdbc.query("SELECT run_id, status, fetched_count, applied_count, failed_count, window_start, window_end, started_at, completed_at, error_message "
                + "FROM legacy_asset_sync_run WHERE sync_code = ? ORDER BY started_at DESC LIMIT ?",
            (rs, row) -> {
                Map<String, Object> item = new LinkedHashMap<>();
                item.put("id", rs.getString("run_id"));
                item.put("status", rs.getString("status"));
                item.put("fetchedCount", rs.getInt("fetched_count"));
                item.put("appliedCount", rs.getInt("applied_count"));
                item.put("failedCount", rs.getInt("failed_count"));
                item.put("windowStart", rs.getTimestamp("window_start").toInstant().toString());
                item.put("windowEnd", rs.getTimestamp("window_end").toInstant().toString());
                item.put("startedAt", rs.getTimestamp("started_at").toInstant().toString());
                if (rs.getTimestamp("completed_at") != null) item.put("completedAt", rs.getTimestamp("completed_at").toInstant().toString());
                if (rs.getString("error_message") != null) item.put("errorMessage", rs.getString("error_message"));
                return item;
            }, SYNC_CODE, boundedLimit);
    }

    List<Map<String, Object>> deadLetters(int limit) {
        int boundedLimit = Math.max(1, Math.min(limit, 200));
        return jdbc.query("SELECT dead_letter_id, event_key, source_asset_id, error_message, retry_count, status, created_at, updated_at "
                + "FROM legacy_asset_sync_dead_letter WHERE status <> ? ORDER BY updated_at DESC LIMIT ?",
            (rs, row) -> {
                Map<String, Object> item = new LinkedHashMap<>();
                item.put("id", rs.getString("dead_letter_id"));
                item.put("eventKey", rs.getString("event_key"));
                item.put("sourceAssetId", rs.getString("source_asset_id"));
                item.put("errorMessage", rs.getString("error_message"));
                item.put("retryCount", rs.getInt("retry_count"));
                item.put("status", rs.getString("status"));
                item.put("createdAt", rs.getTimestamp("created_at").toInstant().toString());
                item.put("updatedAt", rs.getTimestamp("updated_at").toInstant().toString());
                return item;
            }, "RESOLVED", boundedLimit);
    }

    boolean retryDeadLetter(String deadLetterId) {
        int updated = jdbc.update("UPDATE legacy_asset_sync_dead_letter SET status = ?, retry_count = retry_count + 1, updated_at = ? "
                + "WHERE dead_letter_id = ? AND status <> ?",
            "PENDING", Timestamp.from(Instant.now()), deadLetterId, "RESOLVED");
        return updated == 1;
    }

    String startRun(Instant start, Instant end) {
        String id = UUID.randomUUID().toString();
        Instant now = Instant.now();
        jdbc.update("INSERT INTO legacy_asset_sync_run (run_id, sync_code, window_start, window_end, status, fetched_count, applied_count, failed_count, started_at) VALUES (?, ?, ?, ?, ?, 0, 0, 0, ?)",
            id, SYNC_CODE, Timestamp.from(start), Timestamp.from(end), "RUNNING", Timestamp.from(now));
        return id;
    }

    boolean eventExists(String eventKey) {
        Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM legacy_asset_sync_event WHERE event_key = ?", Integer.class, eventKey);
        return count != null && count > 0;
    }

    void recordEvent(String eventKey, String sourceAssetId, int changeType, String payloadHash, String runId) {
        Instant now = Instant.now();
        jdbc.update("INSERT INTO legacy_asset_sync_event (event_key, source_asset_id, change_type, payload_hash, run_id, processed_at) VALUES (?, ?, ?, ?, ?, ?)",
            eventKey, sourceAssetId, changeType, payloadHash, runId, Timestamp.from(now));
        resolveDeadLetters(eventKey, now);
    }

    void resolveDeadLetters(String eventKey) {
        resolveDeadLetters(eventKey, Instant.now());
    }

    private void resolveDeadLetters(String eventKey, Instant now) {
        jdbc.update("UPDATE legacy_asset_sync_dead_letter SET status = ?, updated_at = ? WHERE event_key = ? AND status <> ?",
            "RESOLVED", Timestamp.from(now), eventKey, "RESOLVED");
    }

    void recordDeadLetter(String eventKey, String sourceAssetId, String error) {
        Instant now = Instant.now();
        int updated = jdbc.update("UPDATE legacy_asset_sync_dead_letter SET error_message = ?, updated_at = ? "
                + "WHERE event_key = ? AND status <> ?",
            truncate(error), Timestamp.from(now), eventKey, "RESOLVED");
        if (updated == 1) return;
        jdbc.update("INSERT INTO legacy_asset_sync_dead_letter (dead_letter_id, event_key, source_asset_id, error_message, retry_count, status, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?)",
            UUID.randomUUID().toString(), eventKey, sourceAssetId, truncate(error), "PENDING", Timestamp.from(now), Timestamp.from(now));
    }

    void complete(String runId, Instant cursor, int fetched, int applied, int failed) {
        Instant now = Instant.now();
        jdbc.update("UPDATE legacy_asset_sync_run SET status = ?, fetched_count = ?, applied_count = ?, failed_count = ?, completed_at = ? WHERE run_id = ?",
            failed == 0 ? "SUCCESS" : "FAILED", fetched, applied, failed, Timestamp.from(now), runId);
        if (failed != 0) return;
        if (jdbc.update("UPDATE legacy_asset_sync_state SET cursor_time = ?, updated_at = ? WHERE sync_code = ?",
            Timestamp.from(cursor), Timestamp.from(now), SYNC_CODE) == 0) {
            jdbc.update("INSERT INTO legacy_asset_sync_state (sync_code, cursor_time, updated_at) VALUES (?, ?, ?)",
                SYNC_CODE, Timestamp.from(cursor), Timestamp.from(now));
        }
    }

    void fail(String runId, String error, int fetched, int applied, int failed) {
        jdbc.update("UPDATE legacy_asset_sync_run SET status = ?, fetched_count = ?, applied_count = ?, failed_count = ?, error_message = ?, completed_at = ? WHERE run_id = ?",
            "FAILED", fetched, applied, failed, truncate(error), Timestamp.from(Instant.now()), runId);
    }

    private String truncate(String value) {
        String text = value == null ? "Unknown error" : value;
        return text.length() <= 2_048 ? text : text.substring(0, 2_048);
    }
}
