package team.acg.access.assets.approval;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import team.acg.access.assets.business.BusinessDataRepository;

@Component
public class ApprovalRequestMigration implements ApplicationRunner {
    private final BusinessDataRepository legacyRepository;
    private final ApprovalRequestRepository approvalRequests;

    public ApprovalRequestMigration(BusinessDataRepository legacyRepository,
                                    ApprovalRequestRepository approvalRequests) {
        this.legacyRepository = legacyRepository;
        this.approvalRequests = approvalRequests;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        migrateLegacyRequests();
    }

    @Transactional
    public int migrateLegacyRequests() {
        BusinessDataRepository.Snapshot legacy = legacyRepository.findForUpdate("requests").orElse(null);
        if (legacy == null) return 0;
        if (!legacy.document().isArray()) {
            throw new IllegalStateException("Legacy approval request snapshot is invalid");
        }

        int migrated = 0;
        for (JsonNode value : legacy.document()) {
            if (!value.isObject() || value.path("id").asText().isBlank()) {
                throw new IllegalStateException("Legacy approval request has no valid id");
            }
            ObjectNode request = (ObjectNode) value;
            if (approvalRequests.createIfAbsent(request)) migrated++;
        }
        for (JsonNode value : legacy.document()) {
            if (!approvalRequests.exists(value.path("id").asText())) {
                throw new IllegalStateException("Legacy approval request migration is incomplete");
            }
        }
        if (!legacyRepository.delete("requests", legacy.version())) {
            throw new IllegalStateException("Legacy approval request snapshot changed during migration");
        }
        return migrated;
    }
}
