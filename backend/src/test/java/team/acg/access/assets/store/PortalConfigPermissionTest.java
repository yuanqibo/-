package team.acg.access.assets.store;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.Test;
import team.acg.access.assets.asset.AssetService;
import team.acg.access.assets.auth.RequestIdentityService;

import java.time.Instant;
import java.util.Map;
import java.util.Set;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class PortalConfigPermissionTest {
    @Test
    void requiresDeletePermissionWhenAWholeTreeWriteRemovesNodes() {
        AppStoreRepository repository = mock(AppStoreRepository.class);
        PortalDocumentValidator validator = mock(PortalDocumentValidator.class);
        RequestIdentityService identity = mock(RequestIdentityService.class);
        PortalReferenceCatalog catalog = mock(PortalReferenceCatalog.class);
        AssetService assets = mock(AssetService.class);
        HttpServletRequest request = mock(HttpServletRequest.class);
        var value = new ObjectMapper().createArrayNode();
        var change = new PortalReferenceCatalog.ReferenceChange(
            "category", Map.of(), Set.of("电脑"), Set.of(), false, true, false, false);
        when(catalog.changes(PortalReferenceCatalog.CATEGORY_KEY, value)).thenReturn(change);
        when(repository.saveAll(any())).thenReturn(Instant.EPOCH);
        PortalConfigController controller = new PortalConfigController(repository, validator, identity, catalog, assets);

        controller.saveCatalog("categories", new PortalConfigController.ConfigWrite(value), request);

        verify(identity).requirePermission(request, "asset:category_settings:delete");
    }
}
