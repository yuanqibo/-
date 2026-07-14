package team.acg.access.assets.asset;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

@Component
public class AssetOperationBackfill implements ApplicationRunner {
    private final AssetService assetService;

    public AssetOperationBackfill(AssetService assetService) {
        this.assetService = assetService;
    }

    @Override
    public void run(ApplicationArguments args) {
        assetService.backfillMissingOperationHistory();
    }
}
