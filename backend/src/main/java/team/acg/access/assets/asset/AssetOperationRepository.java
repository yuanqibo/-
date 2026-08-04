package team.acg.access.assets.asset;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.annotation.PostConstruct;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.function.Consumer;

@Repository
public class AssetOperationRepository {
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    public AssetOperationRepository(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    @PostConstruct
    void initialize() {
        jdbc.execute("""
            CREATE TABLE IF NOT EXISTS asset_operation_record (
              operation_id VARCHAR(191) PRIMARY KEY,
              asset_id VARCHAR(191) NOT NULL,
              operation_type VARCHAR(32) NOT NULL,
              operation_status VARCHAR(32) NOT NULL,
              party_subject VARCHAR(191) NOT NULL,
              previous_party_subject VARCHAR(191) NOT NULL,
              document LONGTEXT NOT NULL,
              version BIGINT NOT NULL,
              created_at TIMESTAMP(3) NOT NULL,
              updated_at TIMESTAMP(3) NOT NULL,
              INDEX idx_asset_operation_asset (asset_id),
              INDEX idx_asset_operation_type (operation_type),
              INDEX idx_asset_operation_party (party_subject),
              INDEX idx_asset_operation_previous_party (previous_party_subject)
            )
            """);
    }

    public void create(ObjectNode operation) {
        Instant now = Instant.now();
        jdbc.update("INSERT INTO asset_operation_record "
                + "(operation_id, asset_id, operation_type, operation_status, party_subject, previous_party_subject, "
                + "document, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            operation.path("id").asText(), operation.path("assetId").asText(), operation.path("type").asText(),
            operation.path("status").asText(), operation.path("partySubject").asText(""),
            operation.path("previousPartySubject").asText(""), operation.toString(), 1L,
            Timestamp.from(now), Timestamp.from(now));
    }

    public List<ObjectNode> findAll() {
        return jdbc.query("SELECT document FROM asset_operation_record ORDER BY created_at DESC, operation_id DESC",
            (rs, row) -> read(rs.getString(1)));
    }

    public boolean existsForAsset(String assetId) {
        Integer count = jdbc.queryForObject(
            "SELECT COUNT(*) FROM asset_operation_record WHERE asset_id = ?", Integer.class, assetId);
        return count != null && count > 0;
    }

    public List<ObjectNode> findPage(Set<String> types, Set<String> subjects, int page, int size) {
        if (types == null || types.isEmpty()) return List.of();
        List<String> normalizedTypes = types.stream().sorted().toList();
        String placeholders = String.join(",", java.util.Collections.nCopies(normalizedTypes.size(), "?"));
        List<Object> arguments = new java.util.ArrayList<>(normalizedTypes);
        String subjectClause = subjectClause(subjects, arguments);
        arguments.add(size);
        arguments.add((page - 1) * size);
        return jdbc.query("SELECT document FROM asset_operation_record WHERE operation_type IN (" + placeholders
                + ")" + subjectClause + " ORDER BY created_at DESC, operation_id DESC LIMIT ? OFFSET ?",
            (rs, row) -> read(rs.getString(1)), arguments.toArray());
    }

    public long countByTypes(Set<String> types, Set<String> subjects) {
        if (types == null || types.isEmpty()) return 0;
        List<String> normalizedTypes = types.stream().sorted().toList();
        String placeholders = String.join(",", java.util.Collections.nCopies(normalizedTypes.size(), "?"));
        List<Object> arguments = new java.util.ArrayList<>(normalizedTypes);
        String subjectClause = subjectClause(subjects, arguments);
        Long count = jdbc.queryForObject("SELECT COUNT(*) FROM asset_operation_record WHERE operation_type IN ("
            + placeholders + ")" + subjectClause, Long.class, arguments.toArray());
        return count == null ? 0 : count;
    }

    private String subjectClause(Set<String> subjects, List<Object> arguments) {
        if (subjects == null || subjects.isEmpty()) return "";
        List<String> normalized = subjects.stream().filter(value -> value != null && !value.isBlank()).distinct().toList();
        if (normalized.isEmpty()) return " AND 1 = 0";
        String placeholders = String.join(",", java.util.Collections.nCopies(normalized.size(), "?"));
        arguments.addAll(normalized);
        arguments.addAll(normalized);
        return " AND (party_subject IN (" + placeholders + ") OR previous_party_subject IN (" + placeholders + "))";
    }

    public ObjectNode updateLatest(String assetId, String type, Set<String> statuses,
                                   Consumer<ObjectNode> mutation) {
        List<OperationRecord> candidates = jdbc.query(
            "SELECT document, version FROM asset_operation_record WHERE asset_id = ? AND operation_type = ? "
                + "ORDER BY created_at DESC, operation_id DESC FOR UPDATE",
            (rs, row) -> new OperationRecord(read(rs.getString(1)), rs.getLong(2)), assetId, type);
        OperationRecord record = candidates.stream()
            .filter(candidate -> statuses.contains(candidate.document().path("status").asText()))
            .findFirst()
            .orElseThrow(() -> new IllegalStateException("Matching asset operation was not found: " + assetId + "/" + type));
        ObjectNode updated = record.document().deepCopy();
        mutation.accept(updated);
        Instant now = Instant.now();
        int changed = jdbc.update("UPDATE asset_operation_record SET operation_status = ?, document = ?, "
                + "version = version + 1, updated_at = ? WHERE operation_id = ? AND version = ?",
            updated.path("status").asText(), updated.toString(), Timestamp.from(now),
            updated.path("id").asText(), record.version());
        if (changed != 1) throw new AssetVersionConflictException("Asset operation was modified concurrently: " + updated.path("id").asText());
        return updated;
    }

    private ObjectNode read(String value) {
        try {
            return (ObjectNode) mapper.readTree(value);
        } catch (Exception error) {
            throw new IllegalStateException("Asset operation document is invalid", error);
        }
    }

    private record OperationRecord(ObjectNode document, long version) {}
}
