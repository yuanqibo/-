package team.acg.access.assets.business;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

@Repository
public class BusinessDataRepository {
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    public BusinessDataRepository(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    @PostConstruct
    void initialize() {
        jdbc.execute("""
            CREATE TABLE IF NOT EXISTS business_snapshot (
              snapshot_type VARCHAR(64) PRIMARY KEY,
              document LONGTEXT NOT NULL,
              version BIGINT NOT NULL,
              updated_at TIMESTAMP(3) NOT NULL
            )
            """);
    }

    public Map<String, Snapshot> findAll() {
        Map<String, Snapshot> result = new LinkedHashMap<>();
        jdbc.query("SELECT snapshot_type, document, version, updated_at FROM business_snapshot ORDER BY snapshot_type", (rs, row) ->
            Map.entry(rs.getString(1), new Snapshot(read(rs.getString(2)), rs.getLong(3), rs.getTimestamp(4).toInstant())))
            .forEach(entry -> result.put(entry.getKey(), entry.getValue()));
        return result;
    }

    public Optional<Snapshot> find(String type) {
        return jdbc.query("SELECT document, version, updated_at FROM business_snapshot WHERE snapshot_type = ?", rs ->
            rs.next() ? Optional.of(new Snapshot(read(rs.getString(1)), rs.getLong(2), rs.getTimestamp(3).toInstant())) : Optional.empty(), type);
    }

    public Snapshot create(String type, JsonNode document) {
        Instant now = Instant.now();
        jdbc.update("INSERT INTO business_snapshot (snapshot_type, document, version, updated_at) VALUES (?, ?, ?, ?)",
            type, document.toString(), 1L, Timestamp.from(now));
        return new Snapshot(document, 1L, now);
    }

    public Optional<Snapshot> update(String type, JsonNode document, long expectedVersion) {
        Instant now = Instant.now();
        int changed = jdbc.update("UPDATE business_snapshot SET document = ?, version = version + 1, updated_at = ? WHERE snapshot_type = ? AND version = ?",
            document.toString(), Timestamp.from(now), type, expectedVersion);
        return changed == 0 ? Optional.empty() : Optional.of(new Snapshot(document, expectedVersion + 1, now));
    }

    private JsonNode read(String value) {
        try {
            return mapper.readTree(value);
        } catch (Exception error) {
            throw new IllegalStateException("Business snapshot is invalid", error);
        }
    }

    public record Snapshot(JsonNode document, long version, Instant updatedAt) {}
}
