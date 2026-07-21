package team.acg.access.assets.approval;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

@Configuration
@EnableScheduling
@ConditionalOnProperty(prefix = "asset-portal.approval", name = "enabled", havingValue = "true")
public class ApprovalSchedulingConfiguration {
}
