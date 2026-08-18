package team.acg.access.assets.asset;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import team.acg.access.assets.approval.ApprovalCallbackRepository;
import team.acg.access.assets.approval.ApprovalRequestRepository;
import team.acg.access.assets.business.BusinessDataRepository;

import java.util.List;

@Service
public class AssetCatalogReplacementService {
    private final AssetService assetService;
    private final AssetRepository assetRepository;
    private final AssetOperationRepository operationRepository;
    private final ApprovalRequestRepository approvalRequests;
    private final ApprovalCallbackRepository approvalCallbacks;
    private final BusinessDataRepository businessData;

    public AssetCatalogReplacementService(AssetService assetService, AssetRepository assetRepository,
                                          AssetOperationRepository operationRepository,
                                          ApprovalRequestRepository approvalRequests,
                                          ApprovalCallbackRepository approvalCallbacks,
                                          BusinessDataRepository businessData) {
        this.assetService = assetService;
        this.assetRepository = assetRepository;
        this.operationRepository = operationRepository;
        this.approvalRequests = approvalRequests;
        this.approvalCallbacks = approvalCallbacks;
        this.businessData = businessData;
    }

    @Transactional
    public List<JsonNode> replaceCatalog(List<JsonNode> drafts, AssetService.Actor actor, boolean resetHistory) {
        List<JsonNode> assets = assetService.replaceCatalog(drafts, actor, resetHistory);
        if (!resetHistory) return assets;

        operationRepository.deleteAll();
        approvalRequests.deleteAll();
        approvalCallbacks.deleteAll();
        businessData.deleteAll();
        assetRepository.deleteAuditHistory();
        return assets;
    }
}
