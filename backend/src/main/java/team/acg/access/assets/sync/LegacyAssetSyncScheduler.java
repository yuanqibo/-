package team.acg.access.assets.sync;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(prefix = "asset-portal.legacy-asset-sync", name = "enabled", havingValue = "true")
public class LegacyAssetSyncScheduler {
    private static final Logger log = LoggerFactory.getLogger(LegacyAssetSyncScheduler.class);
    private final LegacyAssetSyncService service;

    LegacyAssetSyncScheduler(LegacyAssetSyncService service) { this.service = service; }

    @Scheduled(cron = "${asset-portal.legacy-asset-sync.cron:0 0/30 * * * *}",
               zone = "${asset-portal.legacy-asset-sync.zone:Asia/Shanghai}")
    void run() {
        try {
            service.run();
        } catch (RuntimeException error) {
            log.error("Legacy asset synchronization failed: {}", error.getMessage(), error);
        }
    }
}
