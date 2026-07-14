package team.acg.access.assets.systemconfig;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

@Repository
public class FormDefinitionRepository {
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    public FormDefinitionRepository(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    @PostConstruct
    void initialize() {
        jdbc.execute("""
            CREATE TABLE IF NOT EXISTS system_form_definition (
              form_id VARCHAR(36) PRIMARY KEY,
              form_code VARCHAR(64) NOT NULL UNIQUE,
              form_name VARCHAR(100) NOT NULL,
              description VARCHAR(1000) NOT NULL,
              enabled BOOLEAN NOT NULL,
              schema_json LONGTEXT NOT NULL,
              version BIGINT NOT NULL,
              created_at TIMESTAMP(3) NOT NULL,
              updated_at TIMESTAMP(3) NOT NULL
            )
            """);
    }

    List<FormRecord> findAll() {
        return jdbc.query("SELECT form_id, form_code, form_name, description, enabled, schema_json, version, created_at, updated_at "
            + "FROM system_form_definition ORDER BY form_code", this::map);
    }

    Optional<FormRecord> findById(String id) {
        return jdbc.query("SELECT form_id, form_code, form_name, description, enabled, schema_json, version, created_at, updated_at "
                + "FROM system_form_definition WHERE form_id = ?",
            rs -> rs.next() ? Optional.of(map(rs, 0)) : Optional.empty(), id);
    }

    FormRecord create(FormRecord value) {
        jdbc.update("INSERT INTO system_form_definition (form_id, form_code, form_name, description, enabled, schema_json, "
                + "version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            value.id(), value.code(), value.name(), value.description(), value.enabled(), write(value.schema()), value.version(),
            Timestamp.from(value.createdAt()), Timestamp.from(value.updatedAt()));
        return value;
    }

    Optional<FormRecord> update(FormRecord value, long expectedVersion) {
        int changed = jdbc.update("UPDATE system_form_definition SET form_code = ?, form_name = ?, description = ?, enabled = ?, "
                + "schema_json = ?, version = version + 1, updated_at = ? WHERE form_id = ? AND version = ?",
            value.code(), value.name(), value.description(), value.enabled(), write(value.schema()), Timestamp.from(value.updatedAt()),
            value.id(), expectedVersion);
        return changed == 0 ? Optional.empty() : Optional.of(new FormRecord(value.id(), value.code(), value.name(),
            value.description(), value.enabled(), value.schema(), expectedVersion + 1, value.createdAt(), value.updatedAt()));
    }

    int delete(String id, long expectedVersion) {
        return jdbc.update("DELETE FROM system_form_definition WHERE form_id = ? AND version = ?", id, expectedVersion);
    }

    private FormRecord map(ResultSet rs, int ignored) throws SQLException {
        return new FormRecord(rs.getString("form_id"), rs.getString("form_code"), rs.getString("form_name"),
            rs.getString("description"), rs.getBoolean("enabled"), read(rs.getString("schema_json")), rs.getLong("version"),
            rs.getTimestamp("created_at").toInstant(), rs.getTimestamp("updated_at").toInstant());
    }

    private String write(JsonNode value) {
        try {
            return mapper.writeValueAsString(value);
        } catch (Exception error) {
            throw new IllegalArgumentException("Form schema cannot be serialized", error);
        }
    }

    private JsonNode read(String value) {
        try {
            return mapper.readTree(value);
        } catch (Exception error) {
            throw new IllegalStateException("Stored form schema is invalid", error);
        }
    }

    record FormRecord(String id, String code, String name, String description, boolean enabled, JsonNode schema,
                      long version, Instant createdAt, Instant updatedAt) {}
}
