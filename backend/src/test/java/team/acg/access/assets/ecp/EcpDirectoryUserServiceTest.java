package team.acg.access.assets.ecp;

import com.idanchuang.ecp.api.common.model.directory.EcpUserProfile;
import com.idanchuang.ecp.sdk.client.EcpClient;
import com.idanchuang.ecp.sdk.client.operation.DirectoryOperations;
import com.idanchuang.ecp.sdk.client.operation.UsersOperations;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class EcpDirectoryUserServiceTest {
    @Test
    void resolvesAStableDirectorySubject() {
        EcpClient client = mock(EcpClient.class);
        DirectoryOperations directory = mock(DirectoryOperations.class);
        UsersOperations users = mock(UsersOperations.class);
        when(client.directory()).thenReturn(directory);
        when(directory.users()).thenReturn(users);
        when(users.getByUnionId("user-1")).thenReturn(profile("user-1"));

        EcpDirectoryUserService.DirectoryParty party = new EcpDirectoryUserService(client).requireBySubject("user-1");

        assertThat(party.subject()).isEqualTo("user-1");
        assertThat(party.name()).isEqualTo("李雷");
        assertThat(party.departmentUnionId()).isEqualTo("department-1");
        assertThat(party.companyUnionId()).isEqualTo("company-1");
    }

    @Test
    void rejectsMissingOrMismatchedSubjects() {
        EcpClient client = mock(EcpClient.class);
        DirectoryOperations directory = mock(DirectoryOperations.class);
        UsersOperations users = mock(UsersOperations.class);
        when(client.directory()).thenReturn(directory);
        when(directory.users()).thenReturn(users);
        when(users.getByUnionId("forged")).thenReturn(profile("different-user"));
        EcpDirectoryUserService service = new EcpDirectoryUserService(client);

        assertThatThrownBy(() -> service.requireBySubject(" ")).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.requireBySubject("forged")).isInstanceOf(IllegalArgumentException.class);
    }

    private EcpUserProfile profile(String unionId) {
        EcpUserProfile.CompanySummary company = new EcpUserProfile.CompanySummary(
            "company-1", "external-company", "示例公司", "account-set-1");
        EcpUserProfile.DepartmentSummary department = new EcpUserProfile.DepartmentSummary(
            "department-1", "external-department", "销售部", "DEPARTMENT", "/总部/销售部", null);
        return new EcpUserProfile(
            "tenant-1", unionId, "external-user", "account-set-1", "李雷",
            "lilei@example.com", "13800000000", "ACTIVE", "EMP-001", "销售经理",
            "department-1", "销售部", "/总部/销售部", company, List.of(department));
    }
}
