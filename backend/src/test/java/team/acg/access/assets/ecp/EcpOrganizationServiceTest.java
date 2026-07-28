package team.acg.access.assets.ecp;

import com.fasterxml.jackson.databind.ObjectMapper;
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
        EcpOrganizationService service = new EcpOrganizationService(
            client, new ObjectMapper(), "http://127.0.0.1:1", "WLY5YG", "test-secret");

        EcpOrganizationService.OrganizationConsole first = service.load("", "");
        EcpOrganizationService.OrganizationConsole second = service.load("", "");

        assertThat(second).isSameAs(first);
        verify(companies, times(1)).list();
        verify(departments, times(1)).list(1, 100);
        verify(users, times(1)).list(1, 100);
        service.close();
    }
}
