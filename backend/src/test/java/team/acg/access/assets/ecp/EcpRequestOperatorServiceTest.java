package team.acg.access.assets.ecp;

import com.idanchuang.ecp.api.common.model.role.ApplicationRole;
import com.idanchuang.ecp.api.common.model.role.ApplicationRoleAssignment;
import com.idanchuang.ecp.sdk.client.EcpClient;
import com.idanchuang.ecp.sdk.client.operation.AssignmentsOperations;
import com.idanchuang.ecp.sdk.client.operation.RolesOperations;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class EcpRequestOperatorServiceTest {
    @Test
    void listsAndDeduplicatesAccountsAssignedToRequestReviewRoles() {
        EcpClient client = mock(EcpClient.class);
        RolesOperations roles = mock(RolesOperations.class);
        AssignmentsOperations assignments = mock(AssignmentsOperations.class);
        ApplicationRole appAdmin = role(1L, "APP_ADMIN", "APP_ADMIN", List.of("asset:request:review"));
        ApplicationRole operator = role(2L, "OPERATOR", "OPERATOR", List.of("asset:request:review"));
        ApplicationRole auditor = role(3L, "APP_AUDITOR", "AUDITOR", List.of("asset:request:view"));
        ApplicationRoleAssignment first = assignment(11L, 1L, "account:user-1", "管理员甲");
        ApplicationRoleAssignment duplicate = assignment(12L, 2L, "account:user-1", "管理员甲");
        ApplicationRoleAssignment second = assignment(13L, 2L, "account:user-2", "管理员乙");

        when(client.roles()).thenReturn(roles);
        when(roles.list()).thenReturn(List.of(appAdmin, operator, auditor));
        when(roles.assignments()).thenReturn(assignments);
        when(assignments.list(null, 1L)).thenReturn(List.of(first));
        when(assignments.list(null, 2L)).thenReturn(List.of(duplicate, second));

        assertThat(new EcpRequestOperatorService(client).list())
            .extracting(EcpRequestOperatorService.RequestOperator::subject,
                EcpRequestOperatorService.RequestOperator::name)
            .containsExactly(
                org.assertj.core.groups.Tuple.tuple("user-1", "管理员甲"),
                org.assertj.core.groups.Tuple.tuple("user-2", "管理员乙"));
    }

    private ApplicationRole role(Long id, String code, String type, List<String> permissions) {
        ApplicationRole role = mock(ApplicationRole.class);
        when(role.id()).thenReturn(id);
        when(role.code()).thenReturn(code);
        when(role.roleTypeCode()).thenReturn(type);
        when(role.status()).thenReturn("enabled");
        when(role.effectivePermissionCodes()).thenReturn(permissions);
        return role;
    }

    private ApplicationRoleAssignment assignment(Long id, Long roleId, String subject, String label) {
        ApplicationRoleAssignment assignment = mock(ApplicationRoleAssignment.class);
        when(assignment.id()).thenReturn(id);
        when(assignment.appRoleId()).thenReturn(roleId);
        when(assignment.subjectType()).thenReturn("ACCOUNT");
        when(assignment.subjectKey()).thenReturn(subject);
        when(assignment.subjectLabel()).thenReturn(label);
        when(assignment.companyName()).thenReturn("示例公司");
        when(assignment.departmentName()).thenReturn("信息部");
        return assignment;
    }
}
