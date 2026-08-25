package team.acg.access.assets;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import team.acg.access.assets.sync.LegacyAssetSyncProperties;

@SpringBootApplication
@EnableConfigurationProperties(LegacyAssetSyncProperties.class)
public class AssetPortalApplication {
    public static void main(String[] args) {
        SpringApplication.run(AssetPortalApplication.class, args);
    }
}
