package team.acg.access.assets.business;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.annotation.PostConstruct;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Repository
public class BusinessDataRepository {
    private static final Map<String, String> TABLES;

    static {
        Map<String, String> tables = new LinkedHashMap<>();
        tables.put("stocktakes", "asset_stocktake_record");
        tables.put("consumables", "consumable_record");
        tables.put("repairs", "asset_repair_record");
        tables.put("contracts", "asset_contract_record");
        tables.put("disposals", "asset_disposal_record");
        TABLES = Collections.unmodifiableMap(tables);
    }

    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    public BusinessDataRepository(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    @PostConstruct
    void initialize() {
        TABLES.values().forEach(table -> jdbc.execute("""
            CREATE TABLE IF NOT EXISTS %s (
              record_id VARCHAR(191) PRIMARY KEY,
              document LONGTEXT NOT NULL,
              version BIGINT NOT NULL,
              created_at TIMESTAMP(3) NOT NULL,
              updated_at TIMESTAMP(3) NOT NULL,
              INDEX idx_%s_updated (updated_at)
            )
            """.formatted(table, table)));
    }

    public Map<String, Snapshot> findAll() {
        Map<String, Snapshot> result = new LinkedHashMap<>();
        TABLES.keySet().forEach(type -> find(type).ifPresent(snapshot -> result.put(type, snapshot)));
        return result;
    }

    public Optional<Snapshot> find(String type) {
        List<StoredRecord> records = readRecords(table(type), false);
        return records.isEmpty() ? Optional.empty() : Optional.of(snapshot(records));
    }

    @Transactional
    public Snapshot create(String type, JsonNode document) {
        String table = table(type);
        List<ObjectNode> items = items(document);
        Instant now = Instant.now();
        for (int index = 0; index < items.size(); index++) {
            ObjectNode item = items.get(index);
            Instant createdAt = now.minusMillis(index);
            jdbc.update("INSERT INTO " + table
                    + " (record_id, document, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                item.path("id").asText(), item.toString(), 1L, Timestamp.from(createdAt), Timestamp.from(now));
        }
        return new Snapshot(document.deepCopy(), items.size(), now);
    }

    @Transactional
    public Optional<Snapshot> update(String type, JsonNode document, long expectedVersion) {
        String table = table(type);
        List<StoredRecord> current = readRecords(table, true);
        if (revision(current) != expectedVersion) return Optional.empty();

        List<ObjectNode> desired = items(document);
        Map<String, StoredRecord> currentById = new LinkedHashMap<>();
        current.forEach(record -> currentById.put(record.id(), record));
        Map<String, ObjectNode> desiredById = new LinkedHashMap<>();
        desired.forEach(item -> desiredById.put(item.path("id").asText(), item));

        current.stream().filter(record -> !desiredById.containsKey(record.id()))
            .forEach(record -> jdbc.update("DELETE FROM " + table + " WHERE record_id = ? AND version = ?",
                record.id(), record.version()));

        Instant now = Instant.now();
        for (int index = 0; index < desired.size(); index++) {
            ObjectNode item = desired.get(index);
            String id = item.path("id").asText();
            StoredRecord stored = currentById.get(id);
            if (stored == null) {
                Instant createdAt = now.minusMillis(index);
                jdbc.update("INSERT INTO " + table
                        + " (record_id, document, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                    id, item.toString(), 1L, Timestamp.from(createdAt), Timestamp.from(now));
            } else if (!stored.document().equals(item)) {
                int changed = jdbc.update("UPDATE " + table
                        + " SET document = ?, version = version + 1, updated_at = ? WHERE record_id = ? AND version = ?",
                    item.toString(), Timestamp.from(now), id, stored.version());
                if (changed != 1) return Optional.empty();
            }
        }
        List<StoredRecord> saved = readRecords(table, false);
        return Optional.of(saved.isEmpty()
            ? new Snapshot(mapper.createArrayNode(), 0L, now)
            : snapshot(saved));
    }

    @Transactional
    public int importLegacy(String type, JsonNode document) {
        String table = table(type);
        List<ObjectNode> legacyItems = items(document);
        Instant now = Instant.now();
        int imported = 0;
        for (int index = 0; index < legacyItems.size(); index++) {
            ObjectNode item = legacyItems.get(index);
            String id = item.path("id").asText();
            List<JsonNode> existing = jdbc.query("SELECT document FROM " + table + " WHERE record_id = ?",
                (rs, row) -> readObject(rs.getString(1)), id);
            if (existing.isEmpty()) {
                Instant createdAt = now.minusMillis(index);
                jdbc.update("INSERT INTO " + table
                        + " (record_id, document, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                    id, item.toString(), 1L, Timestamp.from(createdAt), Timestamp.from(now));
                imported++;
            } else if (!existing.get(0).equals(item)) {
                throw new IllegalStateException("Legacy business record conflicts with existing data: " + type + "/" + id);
            }
        }
        return imported;
    }

    public boolean containsAll(String type, JsonNode document) {
        Map<String, JsonNode> stored = new LinkedHashMap<>();
        readRecords(table(type), false).forEach(record -> stored.put(record.id(), record.document()));
        return items(document).stream().allMatch(item -> item.equals(stored.get(item.path("id").asText())));
    }

    public static boolean supports(String type) {
        return TABLES.containsKey(type);
    }

    private List<StoredRecord> readRecords(String table, boolean forUpdate) {
        String lock = forUpdate ? " FOR UPDATE" : "";
        return jdbc.query("SELECT record_id, document, version, created_at, updated_at FROM " + table
                + " ORDER BY created_at DESC, record_id DESC" + lock,
            (rs, row) -> new StoredRecord(rs.getString(1), readObject(rs.getString(2)), rs.getLong(3),
                rs.getTimestamp(4).toInstant(), rs.getTimestamp(5).toInstant()));
    }

    private Snapshot snapshot(List<StoredRecord> records) {
        ArrayNode document = mapper.createArrayNode();
        records.forEach(record -> document.add(record.document()));
        Instant updatedAt = records.stream().map(StoredRecord::updatedAt).max(Instant::compareTo).orElse(Instant.EPOCH);
        return new Snapshot(document, revision(records), updatedAt);
    }

    private long revision(List<StoredRecord> records) {
        return records.stream().mapToLong(StoredRecord::version).sum();
    }

    private List<ObjectNode> items(JsonNode document) {
        if (document == null || !document.isArray()) {
            throw new IllegalArgumentException("Business data must be an array");
        }
        List<ObjectNode> items = new ArrayList<>();
        Map<String, Boolean> ids = new LinkedHashMap<>();
        for (JsonNode value : document) {
            if (!value.isObject()) throw new IllegalArgumentException("Business records must be objects");
            ObjectNode item = (ObjectNode) value.deepCopy();
            String id = item.path("id").asText("").trim();
            if (id.isEmpty()) throw new IllegalArgumentException("Business record id is required");
            if (ids.putIfAbsent(id, true) != null) {
                throw new IllegalArgumentException("Duplicate business record id: " + id);
            }
            items.add(item);
        }
        return items;
    }

    private String table(String type) {
        String table = TABLES.get(type);
        if (table == null) throw new IllegalArgumentException("Unsupported business data type: " + type);
        return table;
    }

    private ObjectNode readObject(String value) {
        try {
            JsonNode document = mapper.readTree(value);
            if (!document.isObject()) throw new IllegalStateException("Business record is not an object");
            return (ObjectNode) document;
        } catch (Exception error) {
            throw new IllegalStateException("Business record is invalid", error);
        }
    }

    public record Snapshot(JsonNode document, long version, Instant updatedAt) {}

    private record StoredRecord(String id, ObjectNode document, long version, Instant createdAt, Instant updatedAt) {}
}
