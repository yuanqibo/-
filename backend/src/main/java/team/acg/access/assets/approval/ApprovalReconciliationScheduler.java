package team.acg.access.assets.approval;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(prefix = "asset-portal.approval", name = "enabled", havingValue = "true")
public class ApprovalReconciliationScheduler {
    private static final Logger log = LoggerFactory.getLogger(ApprovalReconciliationScheduler.class);
    private final ApprovalCallbackRepository callbacks;
    private final ApprovalIntegrationService integration;
    private final ApprovalRequestStateService requests;

    public ApprovalReconciliationScheduler(ApprovalCallbackRepository callbacks,
                                           ApprovalIntegrationService integration,
                                           ApprovalRequestStateService requests) {
        this.callbacks = callbacks;
        this.integration = integration;
        this.requests = requests;
    }

    @Scheduled(fixedDelayString = "${asset-portal.approval.callback-processing-delay-ms:2000}")
    public void processCallbacks() {
        for (ApprovalCallbackRepository.Event event : callbacks.claimBatch(20)) {
            try {
                requests.applyRemoteDetail(integration.detail(event.approvalNo()));
                callbacks.processed(event.eventId());
            } catch (Exception error) {
                callbacks.failed(event, error);
                log.warn("Approval callback processing failed for event {}: {}", event.eventId(), error.getMessage());
            }
        }
    }

    @Scheduled(initialDelayString = "${asset-portal.approval.reconciliation-delay-ms:30000}",
               fixedDelayString = "${asset-portal.approval.reconciliation-interval-ms:60000}")
    public void reconcilePendingRequests() {
        for (String approvalNo : requests.pendingApprovalNos(50)) {
            try {
                requests.applyRemoteDetail(integration.detail(approvalNo));
            } catch (Exception error) {
                log.warn("Approval reconciliation failed for {}: {}", approvalNo, error.getMessage());
            }
        }
    }
}
