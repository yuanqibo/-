package team.acg.access.assets.store;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

@Repository
public class AppStoreRepository {
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    public AppStoreRepository(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    @PostConstruct
    void initialize() {
        jdbc.execute("""
            CREATE TABLE IF NOT EXISTS app_store (
              store_key VARCHAR(191) PRIMARY KEY,
              store_value LONGTEXT NOT NULL,
              updated_at TIMESTAMP(3) NOT NULL
            )
            """);
    }

    public Map<String, StoreValue> findAll() {
        Map<String, StoreValue> values = new LinkedHashMap<>();
        jdbc.query("SELECT store_key, store_value, updated_at FROM app_store ORDER BY store_key", rs -> {
            values.put(rs.getString(1), new StoreValue(readJson(rs.getString(2)), rs.getTimestamp(3).toInstant()));
        });
        return values;
    }

    public Optional<StoreValue> find(String key) {
        return jdbc.query("SELECT store_value, updated_at FROM app_store WHERE store_key = ?", rs ->
            rs.next() ? Optional.of(new StoreValue(readJson(rs.getString(1)), rs.getTimestamp(2).toInstant())) : Optional.empty(), key);
    }

    public Optional<StoreValue> findForUpdate(String key) {
        return jdbc.query("SELECT store_value, updated_at FROM app_store WHERE store_key = ? FOR UPDATE", rs ->
            rs.next() ? Optional.of(new StoreValue(readJson(rs.getString(1)), rs.getTimestamp(2).toInstant())) : Optional.empty(), key);
    }

    public Instant saveAll(Map<String, JsonNode> entries) {
        Instant now = Instant.now();
        entries.forEach((key, value) -> {
            String json = writeJson(value);
            int updated = jdbc.update("UPDATE app_store SET store_value = ?, updated_at = ? WHERE store_key = ?",
                json, Timestamp.from(now), key);
            if (updated == 0) {
                try {
                    jdbc.update("INSERT INTO app_store (store_key, store_value, updated_at) VALUES (?, ?, ?)",
                        key, json, Timestamp.from(now));
                } catch (DuplicateKeyException race) {
                    jdbc.update("UPDATE app_store SET store_value = ?, updated_at = ? WHERE store_key = ?",
                        json, Timestamp.from(now), key);
                }
            }
        });
        return now;
    }

    public int insertMissing(Map<String, JsonNode> entries) {
        Instant now = Instant.now();
        int inserted = 0;
        for (Map.Entry<String, JsonNode> entry : entries.entrySet()) {
            try {
                inserted += jdbc.update("INSERT INTO app_store (store_key, store_value, updated_at) VALUES (?, ?, ?)",
                    entry.getKey(), writeJson(entry.getValue()), Timestamp.from(now));
            } catch (DuplicateKeyException alreadyInitialized) {
                // Another application instance or an earlier release already owns this value.
            }
        }
        return inserted;
    }

    private JsonNode readJson(String value) {
        try {
            return mapper.readTree(value);
        } catch (Exception error) {
            throw new IllegalStateException("Stored JSON is invalid", error);
        }
    }

    private String writeJson(JsonNode value) {
        try {
            return mapper.writeValueAsString(value);
        } catch (Exception error) {
            throw new IllegalArgumentException("Value cannot be serialized", error);
        }
    }

    public record StoreValue(JsonNode value, Instant updatedAt) {}
}
