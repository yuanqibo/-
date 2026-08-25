package team.acg.access.assets.sync;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

@Configuration
@EnableScheduling
@ConditionalOnProperty(prefix = "asset-portal.legacy-asset-sync", name = "enabled", havingValue = "true")
class LegacyAssetSyncSchedulingConfiguration {
}
