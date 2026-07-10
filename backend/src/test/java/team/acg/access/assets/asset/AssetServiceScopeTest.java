package team.acg.access.assets.asset;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import team.acg.access.assets.auth.RequestIdentityService;

import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class AssetServiceScopeTest {
    private final ObjectMapper mapper = new ObjectMapper();
    private final AssetRepository repository = mock(AssetRepository.class);
    private final AssetService service = new AssetService(repository, mapper);

    @Test
    void employeeOnlySeesOwnedOrDepartmentAssets() throws Exception {
        when(repository.findAll()).thenReturn(List.of(
            mapper.readTree("{\"id\":\"A-1\",\"owner\":\"李雷\",\"department\":\"销售部\"}"),
            mapper.readTree("{\"id\":\"A-2\",\"owner\":\"韩梅梅\",\"department\":\"研发部\"}"),
            mapper.readTree("{\"id\":\"A-3\",\"owner\":\"韩梅梅\",\"department\":\"销售部\"}")));

        var identity = new RequestIdentityService.Identity("李雷", "lilei", "销售部", "employee", Set.of("asset:view"));

        assertThat(service.listFor(identity)).extracting(item -> item.path("id").asText())
            .containsExactly("A-1", "A-3");
    }

    @Test
    void managerSeesAllAssets() throws Exception {
        when(repository.findAll()).thenReturn(List.of(
            mapper.readTree("{\"id\":\"A-1\"}"), mapper.readTree("{\"id\":\"A-2\"}")));

        var identity = new RequestIdentityService.Identity("管理员", "admin", "信息部", "admin", Set.of("asset:view"));

        assertThat(service.listFor(identity)).hasSize(2);
    }
}
