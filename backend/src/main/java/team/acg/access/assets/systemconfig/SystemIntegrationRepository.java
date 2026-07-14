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
public class SystemIntegrationRepository {
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    public SystemIntegrationRepository(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    @PostConstruct
    void initialize() {
        jdbc.execute("""
            CREATE TABLE IF NOT EXISTS system_integration (
              integration_id VARCHAR(36) PRIMARY KEY,
              integration_code VARCHAR(64) NOT NULL UNIQUE,
              integration_name VARCHAR(100) NOT NULL,
              provider VARCHAR(40) NOT NULL,
              base_url VARCHAR(2048) NOT NULL,
              enabled BOOLEAN NOT NULL,
              config_json LONGTEXT NOT NULL,
              secret_ciphertext LONGTEXT NULL,
              version BIGINT NOT NULL,
              created_at TIMESTAMP(3) NOT NULL,
              updated_at TIMESTAMP(3) NOT NULL
            )
            """);
    }

    List<IntegrationRecord> findAll() {
        return jdbc.query("SELECT integration_id, integration_code, integration_name, provider, base_url, enabled, "
            + "config_json, secret_ciphertext, version, created_at, updated_at FROM system_integration ORDER BY integration_code",
            this::map);
    }

    Optional<IntegrationRecord> findById(String id) {
        return jdbc.query("SELECT integration_id, integration_code, integration_name, provider, base_url, enabled, "
            + "config_json, secret_ciphertext, version, created_at, updated_at FROM system_integration WHERE integration_id = ?",
            rs -> rs.next() ? Optional.of(map(rs, 0)) : Optional.empty(), id);
    }

    IntegrationRecord create(IntegrationRecord value) {
        jdbc.update("INSERT INTO system_integration (integration_id, integration_code, integration_name, provider, base_url, "
                + "enabled, config_json, secret_ciphertext, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            value.id(), value.code(), value.name(), value.provider(), value.baseUrl(), value.enabled(), write(value.config()),
            value.secretCiphertext(), value.version(), Timestamp.from(value.createdAt()), Timestamp.from(value.updatedAt()));
        return value;
    }

    Optional<IntegrationRecord> update(IntegrationRecord value, long expectedVersion) {
        int changed = jdbc.update("UPDATE system_integration SET integration_code = ?, integration_name = ?, provider = ?, "
                + "base_url = ?, enabled = ?, config_json = ?, secret_ciphertext = ?, version = version + 1, updated_at = ? "
                + "WHERE integration_id = ? AND version = ?",
            value.code(), value.name(), value.provider(), value.baseUrl(), value.enabled(), write(value.config()),
            value.secretCiphertext(), Timestamp.from(value.updatedAt()), value.id(), expectedVersion);
        return changed == 0 ? Optional.empty() : Optional.of(new IntegrationRecord(
            value.id(), value.code(), value.name(), value.provider(), value.baseUrl(), value.enabled(), value.config(),
            value.secretCiphertext(), expectedVersion + 1, value.createdAt(), value.updatedAt()));
    }

    private IntegrationRecord map(ResultSet rs, int ignored) throws SQLException {
        return new IntegrationRecord(rs.getString("integration_id"), rs.getString("integration_code"),
            rs.getString("integration_name"), rs.getString("provider"), rs.getString("base_url"), rs.getBoolean("enabled"),
            read(rs.getString("config_json")), rs.getString("secret_ciphertext"), rs.getLong("version"),
            rs.getTimestamp("created_at").toInstant(), rs.getTimestamp("updated_at").toInstant());
    }

    private String write(JsonNode value) {
        try {
            return mapper.writeValueAsString(value);
        } catch (Exception error) {
            throw new IllegalArgumentException("Integration config cannot be serialized", error);
        }
    }

    private JsonNode read(String value) {
        try {
            return mapper.readTree(value);
        } catch (Exception error) {
            throw new IllegalStateException("Stored integration config is invalid", error);
        }
    }

    record IntegrationRecord(String id, String code, String name, String provider, String baseUrl, boolean enabled,
                             JsonNode config, String secretCiphertext, long version, Instant createdAt, Instant updatedAt) {}
}
