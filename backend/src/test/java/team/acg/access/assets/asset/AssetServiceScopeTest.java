package team.acg.access.assets.asset;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import team.acg.access.assets.auth.RequestIdentityService;
import team.acg.access.assets.store.PortalReferenceCatalog;

import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class AssetServiceScopeTest {
    private final ObjectMapper mapper = new ObjectMapper();
    private final AssetRepository repository = mock(AssetRepository.class);
    private final AssetService service = new AssetService(
        repository, mapper, mock(PortalReferenceCatalog.class), mock(AssetCodeGenerator.class),
        mock(AssetWorkflowPolicy.class), mock(AssetOperationRepository.class));

    @Test
    void employeeOnlySeesOwnedAssets() throws Exception {
        when(repository.findAll()).thenReturn(List.of(
            mapper.readTree("{\"id\":\"A-1\",\"owner\":\"李雷\",\"ownerSubject\":\"user-1\",\"department\":\"销售部\"}"),
            mapper.readTree("{\"id\":\"A-2\",\"owner\":\"韩梅梅\",\"department\":\"研发部\"}"),
            mapper.readTree("{\"id\":\"A-3\",\"owner\":\"韩梅梅\",\"department\":\"销售部\"}"),
            mapper.readTree("{\"id\":\"A-4\",\"owner\":\"李雷\",\"ownerSubject\":\"\",\"department\":\"销售部\"}")));

        var identity = new RequestIdentityService.Identity(
            "李雷", "lilei", "account-1", "user-1", "tenant-1", "销售部", "示例公司", Set.of("dept-sales"), "employee", Set.of("asset:item:view"));

        assertThat(service.listFor(identity)).extracting(item -> item.path("id").asText())
            .containsExactly("A-1");
    }

    @Test
    void managerSeesAllAssets() throws Exception {
        when(repository.findAll()).thenReturn(List.of(
            mapper.readTree("{\"id\":\"A-1\"}"), mapper.readTree("{\"id\":\"A-2\"}")));

        var identity = new RequestIdentityService.Identity(
            "管理员", "admin", "account-admin", "user-admin", "tenant-1", "信息部", "示例公司", Set.of("dept-it"), "admin",
            Set.of("asset:item:view", "asset:request:review"));

        assertThat(service.listFor(identity)).hasSize(2);
    }

    @Test
    void employeeWithRequestPermissionSeesOwnAndAvailableAssetsButNotOtherAssignedAssets() throws Exception {
        when(repository.findAll()).thenReturn(List.of(
            mapper.readTree("{\"id\":\"A-1\",\"owner\":\"李雷\",\"ownerSubject\":\"user-1\",\"status\":\"领用\"}"),
            mapper.readTree("{\"id\":\"A-2\",\"owner\":\"未分配\",\"ownerSubject\":\"\",\"status\":\"空闲\"}"),
            mapper.readTree("{\"id\":\"A-3\",\"owner\":\"韩梅梅\",\"ownerSubject\":\"user-2\",\"status\":\"领用\"}")));

        var identity = new RequestIdentityService.Identity(
            "李雷", "lilei", "account-1", "user-1", "tenant-1", "销售部", "示例公司", Set.of("dept-sales"), "employee",
            Set.of("asset:item:view", "asset:request:create"));

        assertThat(service.listFor(identity)).extracting(item -> item.path("id").asText())
            .containsExactly("A-1", "A-2");
    }

    @Test
    void onlyTheIdleStatusIsAssignable() throws Exception {
        assertThat(service.isAvailable(mapper.readTree("{\"status\":\"空闲\"}"))).isTrue();
        assertThat(service.isAvailable(mapper.readTree("{\"status\":\"闲置\"}"))).isFalse();
        assertThat(service.isAvailable(mapper.readTree("{\"status\":\"领用\"}"))).isFalse();
        assertThat(service.isAvailable(mapper.readTree("{\"status\":\"借用中\"}"))).isFalse();
    }
}
