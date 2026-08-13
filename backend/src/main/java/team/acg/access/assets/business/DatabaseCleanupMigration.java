package team.acg.access.assets.business;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.BadSqlGrammarException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import team.acg.access.assets.approval.ApprovalRequestRepository;

import java.util.List;

@Component
public class DatabaseCleanupMigration implements ApplicationRunner {
    private static final String LEGACY_ASSET_KEY = "assetPortalAssets";
    private static final String LEGACY_BACKUP_TABLE = "app_store_pre_java_20260723_030516";

    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    private final BusinessDataRepository businessData;
    private final ApprovalRequestRepository approvalRequests;

    public DatabaseCleanupMigration(JdbcTemplate jdbc, ObjectMapper mapper, BusinessDataRepository businessData,
                                    ApprovalRequestRepository approvalRequests) {
        this.jdbc = jdbc;
        this.mapper = mapper;
        this.businessData = businessData;
        this.approvalRequests = approvalRequests;
    }

    @Override
    public void run(ApplicationArguments args) {
        clean();
    }

    @Transactional
    public CleanupResult clean() {
        int migratedBusinessRecords = 0;
        int migratedApprovalRequests = 0;
        List<LegacySnapshot> snapshots = legacySnapshots();
        for (LegacySnapshot snapshot : snapshots) {
            if ("requests".equals(snapshot.type())) {
                migratedApprovalRequests += migrateRequests(snapshot.document());
            } else if (BusinessDataRepository.supports(snapshot.type())) {
                migratedBusinessRecords += businessData.importLegacy(snapshot.type(), snapshot.document());
            } else {
                throw new IllegalStateException("Unknown legacy business data type: " + snapshot.type());
            }
        }
        verifySnapshots(snapshots);
        if (!snapshots.isEmpty() || tableExists("business_snapshot")) {
            jdbc.execute("DROP TABLE business_snapshot");
        }
        int removedLegacyAssets = jdbc.update("DELETE FROM app_store WHERE store_key = ?", LEGACY_ASSET_KEY);
        jdbc.execute("DROP TABLE IF EXISTS " + LEGACY_BACKUP_TABLE);
        return new CleanupResult(migratedBusinessRecords, migratedApprovalRequests, removedLegacyAssets);
    }

    private List<LegacySnapshot> legacySnapshots() {
        if (!tableExists("business_snapshot")) return List.of();
        return jdbc.query("SELECT snapshot_type, document FROM business_snapshot ORDER BY snapshot_type",
            (rs, row) -> new LegacySnapshot(rs.getString(1), read(rs.getString(2))));
    }

    private int migrateRequests(JsonNode document) {
        if (!document.isArray()) throw new IllegalStateException("Legacy approval request snapshot is invalid");
        int migrated = 0;
        for (JsonNode value : document) {
            if (!value.isObject() || value.path("id").asText().isBlank()) {
                throw new IllegalStateException("Legacy approval request has no valid id");
            }
            if (approvalRequests.createIfAbsent((ObjectNode) value)) migrated++;
        }
        return migrated;
    }

    private void verifySnapshots(List<LegacySnapshot> snapshots) {
        for (LegacySnapshot snapshot : snapshots) {
            if ("requests".equals(snapshot.type())) {
                for (JsonNode value : snapshot.document()) {
                    if (!approvalRequests.exists(value.path("id").asText())) {
                        throw new IllegalStateException("Legacy approval request migration is incomplete");
                    }
                }
            } else if (!businessData.containsAll(snapshot.type(), snapshot.document())) {
                throw new IllegalStateException("Legacy business data migration is incomplete: " + snapshot.type());
            }
        }
    }

    private boolean tableExists(String table) {
        try {
            jdbc.queryForObject("SELECT COUNT(*) FROM " + table + " WHERE 1 = 0", Integer.class);
            return true;
        } catch (BadSqlGrammarException missing) {
            return false;
        }
    }

    private JsonNode read(String value) {
        try {
            return mapper.readTree(value);
        } catch (Exception error) {
            throw new IllegalStateException("Legacy business snapshot is invalid", error);
        }
    }

    public record CleanupResult(int migratedBusinessRecords, int migratedApprovalRequests, int removedLegacyAssets) {}

    private record LegacySnapshot(String type, JsonNode document) {}
}
