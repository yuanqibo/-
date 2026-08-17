package team.acg.access.assets.ecp;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.idanchuang.ecp.api.common.model.directory.EcpCompanyProfile;
import com.idanchuang.ecp.api.common.model.directory.EcpDepartmentProfile;
import com.idanchuang.ecp.api.common.model.directory.EcpUserProfile;
import com.idanchuang.ecp.sdk.client.EcpClient;
import com.idanchuang.ecp.sdk.client.model.EcpPage;
import com.idanchuang.ecp.sdk.client.operation.CompaniesOperations;
import com.idanchuang.ecp.sdk.client.operation.DepartmentsOperations;
import com.idanchuang.ecp.sdk.client.operation.DirectoryOperations;
import com.idanchuang.ecp.sdk.client.operation.UsersOperations;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class EcpOrganizationServiceTest {
    @Test
    void reusesTheTenantOrganizationSnapshotWithinTheShortCacheWindow() {
        EcpClient client = mock(EcpClient.class);
        DirectoryOperations directory = mock(DirectoryOperations.class);
        CompaniesOperations companies = mock(CompaniesOperations.class);
        DepartmentsOperations departments = mock(DepartmentsOperations.class);
        UsersOperations users = mock(UsersOperations.class);
        when(client.directory()).thenReturn(directory);
        when(directory.companies()).thenReturn(companies);
        when(directory.departments()).thenReturn(departments);
        when(directory.users()).thenReturn(users);
        when(companies.list()).thenReturn(List.of());
        when(departments.list(1, 100)).thenReturn(new EcpPage<>(List.of(), 1, 100, 0));
        when(users.list(1, 100)).thenReturn(new EcpPage<>(List.of(), 1, 100, 0));
        EcpSelectableDirectoryService selectableDirectory = mock(EcpSelectableDirectoryService.class);
        EcpOrganizationService service = new EcpOrganizationService(
            client, new ObjectMapper(), selectableDirectory,
            "http://127.0.0.1:1", "WLY5YG", "test-secret");

        EcpOrganizationService.OrganizationConsole first = service.load("", "");
        EcpOrganizationService.OrganizationConsole second = service.load("", "");

        assertThat(second).isSameAs(first);
        verify(companies, times(1)).list();
        verify(departments, times(1)).list(1, 100);
        verify(users, times(1)).list(1, 100);
        service.close();
    }

    @Test
    void usesSessionScopedSelectableDirectoryForOrganizationConsole() {
        EcpClient client = mock(EcpClient.class);
        EcpSelectableDirectoryService selectableDirectory = mock(EcpSelectableDirectoryService.class);
        EcpCompanyProfile company = new EcpCompanyProfile(
            "", "company-1", "", "", "示例公司", "ACTIVE", "", "company-1");
        EcpDepartmentProfile department = new EcpDepartmentProfile(
            "", "department-1", "", "", "行政管理", "DEPARTMENT",
            "示例公司/行政管理", "ACTIVE", "", "company-1", "company-1", "", "示例公司",
            new EcpDepartmentProfile.LeaderSummary("user-1", "", "任吉财"));
        EcpUserProfile user = new EcpUserProfile(
            "", "user-1", "", "", "任吉财", "", "", "ACTIVE", "A001", "",
            "department-1", "行政管理", "示例公司/行政管理",
            new EcpUserProfile.CompanySummary("company-1", "", "示例公司", ""),
            List.of(new EcpUserProfile.DepartmentSummary(
                "department-1", "", "行政管理", "DEPARTMENT", "示例公司/行政管理", null)));
        when(selectableDirectory.snapshot("Bearer session-token"))
            .thenReturn(new EcpSelectableDirectoryService.DirectorySnapshot(
                List.of(company), List.of(department), List.of(user)));
        EcpOrganizationService service = new EcpOrganizationService(
            client, new ObjectMapper(), selectableDirectory,
            "http://127.0.0.1:1", "WLY5YG", "test-secret");

        EcpOrganizationService.OrganizationConsole result = service.load("tenant-1", "Bearer session-token");

        assertThat(result.users()).extracting(EcpOrganizationService.UserView::name).containsExactly("任吉财");
        assertThat(result.users().get(0).leaderDepartmentNames()).containsExactly("行政管理");
        assertThat(result.roots()).singleElement().satisfies(root -> {
            assertThat(root.name()).isEqualTo("示例公司");
            assertThat(root.memberSubjects()).containsExactly("user-1");
            assertThat(root.children()).extracting(EcpOrganizationService.OrganizationNode::name)
                .containsExactly("行政管理");
        });
        verifyNoInteractions(client);
        service.close();
    }
}
