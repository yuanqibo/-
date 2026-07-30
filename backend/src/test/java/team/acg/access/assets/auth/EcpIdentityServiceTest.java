package team.acg.access.assets.auth;

import com.idanchuang.ecp.api.common.model.session.EcpSessionContext;
import com.idanchuang.ecp.api.common.model.role.ApplicationRole;
import com.idanchuang.ecp.sdk.client.EcpClient;
import com.idanchuang.ecp.sdk.client.operation.AssignmentsOperations;
import com.idanchuang.ecp.sdk.client.operation.RolesOperations;
import com.idanchuang.ecp.sdk.client.operation.SessionOperations;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.isNull;

class EcpIdentityServiceTest {
    @Test
    void invalidatesCachedIdentityAfterAuthorizationChanges() {
        EcpClient client = mock(EcpClient.class);
        SessionOperations session = mock(SessionOperations.class);
        RolesOperations roles = mock(RolesOperations.class);
        AssignmentsOperations assignments = mock(AssignmentsOperations.class);
        when(client.session("session-token")).thenReturn(session);
        when(session.context()).thenReturn(context("APP_ADMIN", "APP_ADMIN", List.of("asset:item:view")));
        when(client.roles()).thenReturn(roles);
        when(roles.list()).thenReturn(List.of());
        when(roles.assignments()).thenReturn(assignments);
        when(assignments.list(anyString(), isNull())).thenReturn(List.of());
        EcpIdentityService service = new EcpIdentityService(client, Duration.ofMinutes(1), true);

        service.resolve("session-token");
        service.invalidateAll();
        service.resolve("session-token");

        verify(session, times(2)).context();
    }

    @Test
    void reusesAResolvedIdentityForConcurrentPageRequests() {
        EcpClient client = mock(EcpClient.class);
        SessionOperations session = mock(SessionOperations.class);
        RolesOperations roles = mock(RolesOperations.class);
        AssignmentsOperations assignments = mock(AssignmentsOperations.class);
        when(client.session("same-session-token")).thenReturn(session);
        when(session.context()).thenReturn(context("APP_ADMIN", "APP_ADMIN", List.of("asset:item:view")));
        when(client.roles()).thenReturn(roles);
        when(roles.list()).thenReturn(List.of());
        when(roles.assignments()).thenReturn(assignments);
        when(assignments.list(anyString(), isNull())).thenReturn(List.of());
        EcpIdentityService service = new EcpIdentityService(client, Duration.ofSeconds(10), false);

        Map<String, Object> first = service.resolve("same-session-token");
        Map<String, Object> second = service.resolve("same-session-token");

        assertThat(second).isSameAs(first);
        verify(session, times(1)).context();
        verify(roles, times(0)).list();
    }

    @Test
    void grantsAuthenticatedEmployeesTheMinimalSelfServicePermissionsWithoutAnAssignedRole() {
        EcpSessionContext context = context(null, null, List.of());

        var identity = EcpIdentityService.normalize(context);

        assertThat(identity.get("roleCode")).isEqualTo("employee");
        assertThat(identity.get("permissionCodes")).isEqualTo(EmployeeSelfServiceAccess.PERMISSIONS);
    }

    @Test
    void derivesManagementIdentityFromTrustedEcpRoleType() {
        EcpSessionContext context = context("APP_ADMIN", "APP_ADMIN", List.of("asset:item:view"));

        var identity = EcpIdentityService.normalize(context);

        assertThat(identity.get("roleCode")).isEqualTo("super_admin");
        assertThat(identity.get("subject")).isEqualTo("account-union-1");
        assertThat(identity.get("directorySubject")).isEqualTo("user-union-1");
        assertThat(identity.get("tenantId")).isEqualTo("tenant-1");
        assertThat(identity.get("departmentUnionIds")).isEqualTo(List.of("department-1"));
    }

    @Test
    void doesNotPromoteAnEmployeeBecauseOfIndividualPermissions() {
        EcpSessionContext context = context("EMPLOYEE_SELF_SERVICE", "EMPLOYEE",
            List.of("asset:item:view", "asset:integration:create"));

        var identity = EcpIdentityService.normalize(context);

        assertThat(identity.get("roleCode")).isEqualTo("employee");
    }

    @Test
    void handoverSignaturePermissionDoesNotPromoteAnEmployeeToManager() {
        EcpSessionContext context = context("EMPLOYEE_SELF_SERVICE", "EMPLOYEE", List.of(
            "asset:item:view", "asset:receive_return:view", "asset:receive_return:sign"));

        var identity = EcpIdentityService.normalize(context);

        assertThat(identity.get("roleCode")).isEqualTo("employee");
    }

    @Test
    void treatsAuditorAsAReadOnlyManagementScope() {
        EcpSessionContext context = context("APP_AUDITOR", "AUDITOR", List.of("asset:item:view"));

        assertThat(EcpIdentityService.normalize(context).get("roleCode")).isEqualTo("admin");
    }

    @Test
    @SuppressWarnings("unchecked")
    void reconcilesAStoredAccountAssignmentWhenThePublicSessionOmitsIt() {
        EcpSessionContext context = context("EMPLOYEE_SELF_SERVICE", "VIEWER", List.of("asset:item:view"));
        ApplicationRole appAdmin = mock(ApplicationRole.class);
        when(appAdmin.code()).thenReturn("APP_ADMIN");
        when(appAdmin.roleTypeCode()).thenReturn("APP_ADMIN");
        when(appAdmin.effectivePermissionCodes()).thenReturn(List.of("asset:item:create", "authz:app_role:assign"));
        when(appAdmin.effectiveFeatureCodes()).thenReturn(List.of("PORTAL_ASSETS", "PORTAL_SETTINGS", "APP_WORKSPACE"));
        var identity = EcpIdentityService.normalize(context);

        EcpIdentityService.mergeAuthoritativeAccountRoles(identity, context.user(), List.of(appAdmin));

        assertThat(identity.get("roleCode")).isEqualTo("super_admin");
        assertThat((Set<String>) identity.get("roleCodes")).contains("APP_ADMIN");
        assertThat((Set<String>) identity.get("permissionCodes")).contains("asset:item:create", "authz:app_role:assign");
        assertThat((Set<String>) identity.get("featureCodes")).contains("PORTAL_SETTINGS", "APP_WORKSPACE");
        assertThat(identity.get("roleAssignmentReconciled")).isEqualTo(true);
    }

    private EcpSessionContext context(String roleCode, String roleType, List<String> permissions) {
        EcpSessionContext.Department department = new EcpSessionContext.Department(
            "department-1", "SALES", "销售部", "/总部/销售部");
        EcpSessionContext.User user = new EcpSessionContext.User(
            "account-union-1", "user-union-1", "external-1", "EMP-001", "李雷", "李雷",
            "lilei@example.com", "13800000000", "", "EMPLOYEE", "account-set-1", "STAFF",
            "员工账号集", "示例公司", List.of(department));
        EcpSessionContext.Company company = new EcpSessionContext.Company(
            "company-1", "COMPANY", "示例公司", "account-set-1", "ECP");
        EcpSessionContext.Tenant tenant = new EcpSessionContext.Tenant(
            "tenant-1", "example.test", true, "default", company);
        return new EcpSessionContext(
            "WLY5YG", "asset-platform", "资产平台", "", "session-1",
            OffsetDateTime.now(), OffsetDateTime.now().plusHours(1), user, tenant,
            roleCode == null ? List.of() : List.of(new EcpSessionContext.Role(roleCode, roleCode, roleType)),
            permissions, List.of());
    }
}
