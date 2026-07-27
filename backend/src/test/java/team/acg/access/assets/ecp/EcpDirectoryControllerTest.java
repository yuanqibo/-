package team.acg.access.assets.ecp;

import com.idanchuang.ecp.api.common.model.directory.EcpUserProfile;
import com.idanchuang.ecp.sdk.client.EcpClient;
import com.idanchuang.ecp.sdk.client.model.EcpPage;
import com.idanchuang.ecp.sdk.client.operation.DirectoryOperations;
import com.idanchuang.ecp.sdk.client.operation.UsersOperations;
import com.idanchuang.ecp.sdk.spring.annotation.RequireAnyPermission;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Arrays;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class EcpDirectoryControllerTest {
    @Test
    void allowsEcpGovernanceAndAssetOperatorsToReadDirectory() throws Exception {
        RequireAnyPermission annotation = EcpDirectoryController.class
            .getMethod("users", String.class, int.class, int.class)
            .getAnnotation(RequireAnyPermission.class);

        assertThat(annotation).isNotNull();
        assertThat(Arrays.stream(annotation.value()).map(spec -> spec.value()).toList())
            .containsExactlyInAnyOrder(
                "asset:employee:view",
                "asset:department:view",
                "asset:item:create",
                "asset:item:receive",
                "asset:item:borrow",
                "asset:item:handover",
                "asset:item:update",
                "asset:item:batchUpdate",
                "asset:receive_return:receive",
                "asset:receive_return:handover",
                "asset:borrow_return:borrow",
                "asset:request:create",
                "asset:request:review");
    }

    @Test
    void searchesUsersThroughThePublicEcpClientSurface() {
        EcpClient client = mock(EcpClient.class);
        DirectoryOperations directory = mock(DirectoryOperations.class);
        UsersOperations users = mock(UsersOperations.class);
        when(client.directory()).thenReturn(directory);
        when(directory.users()).thenReturn(users);
        when(users.search("李雷", 1, 20)).thenReturn(new EcpPage<>(List.of(profile()), 1, 20, 1));

        EcpDirectoryController.DirectoryUserPage result =
            new EcpDirectoryController(client).users(" 李雷 ", 1, 20);

        assertThat(result.items()).hasSize(1);
        assertThat(result.items().get(0).subject()).isEqualTo("user-1");
        assertThat(result.items().get(0).displayName()).isEqualTo("李雷");
        assertThat(result.items().get(0).unionId()).isEqualTo("user-1");
        assertThat(result.items().get(0).company().unionId()).isEqualTo("company-1");
        assertThat(result.items().get(0).departments().get(0).unionId()).isEqualTo("department-1");
    }

    @Test
    void boundsDirectoryQueriesBeforeCallingEcp() {
        EcpDirectoryController controller = new EcpDirectoryController(mock(EcpClient.class));

        assertThatThrownBy(() -> controller.users("x", 0, 20)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> controller.users("x", 1, 101)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> controller.users("x".repeat(101), 1, 20)).isInstanceOf(IllegalArgumentException.class);
    }

    private EcpUserProfile profile() {
        EcpUserProfile.CompanySummary company = new EcpUserProfile.CompanySummary(
            "company-1", "external-company", "示例公司", "account-set-1");
        EcpUserProfile.DepartmentSummary department = new EcpUserProfile.DepartmentSummary(
            "department-1", "external-department", "销售部", "DEPARTMENT", "/总部/销售部", null);
        return new EcpUserProfile(
            "tenant-1", "user-1", "external-user", "account-set-1", "李雷",
            "lilei@example.com", "13800000000", "ACTIVE", "EMP-001", "销售经理",
            "department-1", "销售部", "/总部/销售部", company, List.of(department));
    }
}
