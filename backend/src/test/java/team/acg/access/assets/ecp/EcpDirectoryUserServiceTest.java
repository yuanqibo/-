package team.acg.access.assets.ecp;

import com.idanchuang.ecp.api.common.model.directory.EcpUserProfile;
import com.idanchuang.ecp.sdk.client.EcpClient;
import com.idanchuang.ecp.sdk.client.model.EcpPage;
import com.idanchuang.ecp.sdk.client.operation.DirectoryOperations;
import com.idanchuang.ecp.sdk.client.operation.UsersOperations;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class EcpDirectoryUserServiceTest {
    @Test
    void resolvesAStableDirectorySubjectFromTheApplicationDirectory() {
        EcpClient client = mock(EcpClient.class);
        DirectoryOperations directory = mock(DirectoryOperations.class);
        UsersOperations users = mock(UsersOperations.class);
        when(client.directory()).thenReturn(directory);
        when(directory.users()).thenReturn(users);
        when(users.search("user-1", 1, 100)).thenReturn(page(profile("user-1")));

        EcpDirectoryUserService.DirectoryParty party = new EcpDirectoryUserService(client).requireBySubject("user-1");

        assertThat(party.subject()).isEqualTo("user-1");
        assertThat(party.name()).isEqualTo("李雷");
        assertThat(party.departmentUnionId()).isEqualTo("department-1");
        assertThat(party.companyUnionId()).isEqualTo("company-1");
        verify(users, never()).getByUnionId("user-1");
    }

    @Test
    void reusesAProfileReturnedByDirectorySearchWhenTheCommandIsSubmitted() {
        EcpClient client = mock(EcpClient.class);
        DirectoryOperations directory = mock(DirectoryOperations.class);
        UsersOperations users = mock(UsersOperations.class);
        when(client.directory()).thenReturn(directory);
        when(directory.users()).thenReturn(users);
        when(users.search("李雷", 1, 20)).thenReturn(new EcpPage<>(List.of(profile("user-1")), 1, 20, 1));
        EcpDirectoryUserService service = new EcpDirectoryUserService(client);

        service.page("李雷", 1, 20);
        EcpDirectoryUserService.DirectoryParty party = service.requireBySubject("user-1");

        assertThat(party.name()).isEqualTo("李雷");
        verify(users).search("李雷", 1, 20);
        verify(users, never()).search("user-1", 1, 100);
        verify(users, never()).getByUnionId("user-1");
    }

    @Test
    void findsAnExactSubjectFromPagedDirectoryWhenSearchDoesNotIndexUnionIds() {
        EcpClient client = mock(EcpClient.class);
        DirectoryOperations directory = mock(DirectoryOperations.class);
        UsersOperations users = mock(UsersOperations.class);
        when(client.directory()).thenReturn(directory);
        when(directory.users()).thenReturn(users);
        when(users.search("user-2", 1, 100)).thenReturn(new EcpPage<>(List.of(), 1, 100, 0));
        when(users.list(1, 100)).thenReturn(new EcpPage<>(List.of(profile("user-1")), 1, 100, 101));
        when(users.list(2, 100)).thenReturn(new EcpPage<>(List.of(profile("user-2")), 2, 100, 101));

        EcpDirectoryUserService.DirectoryParty party = new EcpDirectoryUserService(client).requireBySubject("user-2");

        assertThat(party.subject()).isEqualTo("user-2");
        verify(users).list(2, 100);
        verify(users, never()).getByUnionId("user-2");
    }

    @Test
    void rejectsMissingOrMismatchedSubjects() {
        EcpClient client = mock(EcpClient.class);
        DirectoryOperations directory = mock(DirectoryOperations.class);
        UsersOperations users = mock(UsersOperations.class);
        when(client.directory()).thenReturn(directory);
        when(directory.users()).thenReturn(users);
        when(users.search("forged", 1, 100)).thenReturn(page(profile("different-user")));
        when(users.list(1, 100)).thenReturn(page(profile("different-user")));
        EcpDirectoryUserService service = new EcpDirectoryUserService(client);

        assertThatThrownBy(() -> service.requireBySubject(" ")).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.requireBySubject("forged")).isInstanceOf(IllegalArgumentException.class);
    }

    private EcpPage<EcpUserProfile> page(EcpUserProfile... profiles) {
        return new EcpPage<>(List.of(profiles), 1, 100, profiles.length);
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
