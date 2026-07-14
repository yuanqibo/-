package team.acg.access.assets.auth;

import com.idanchuang.ecp.api.common.model.session.EcpSessionContext;
import org.junit.jupiter.api.Test;

import java.time.OffsetDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class EcpIdentityServiceTest {
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
            List.of(new EcpSessionContext.Role(roleCode, roleCode, roleType)),
            permissions, List.of());
    }
}
