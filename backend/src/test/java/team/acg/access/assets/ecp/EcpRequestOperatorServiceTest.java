package team.acg.access.assets.ecp;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.idanchuang.ecp.api.common.model.role.ApplicationRole;
import com.idanchuang.ecp.api.common.model.role.ApplicationRoleAssignment;
import com.idanchuang.ecp.sdk.client.EcpClient;
import com.idanchuang.ecp.sdk.client.EcpRequestOptions;
import com.idanchuang.ecp.sdk.client.operation.AssignmentsOperations;
import com.idanchuang.ecp.sdk.client.operation.RolesOperations;
import com.idanchuang.ecp.sdk.spring.session.SessionTokenResolver;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.mock.web.MockHttpServletRequest;
import team.acg.access.assets.auth.RequestIdentityService;
import team.acg.access.assets.store.AppStoreRepository;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class EcpRequestOperatorServiceTest {
    private EcpClient client;
    private EcpClient sessionClient;
    private RolesOperations roles;
    private AssignmentsOperations assignments;
    private AppStoreRepository store;
    private ObjectMapper mapper;
    private SessionTokenResolver tokenResolver;
    private RequestIdentityService identityService;
    private EcpRequestOperatorService service;

    @BeforeEach
    void setUp() {
        client = mock(EcpClient.class);
        sessionClient = mock(EcpClient.class);
        roles = mock(RolesOperations.class);
        assignments = mock(AssignmentsOperations.class);
        store = mock(AppStoreRepository.class);
        mapper = new ObjectMapper();
        tokenResolver = mock(SessionTokenResolver.class);
        identityService = mock(RequestIdentityService.class);
        ObjectProvider<SessionTokenResolver> tokenResolverProvider = mock(ObjectProvider.class);
        when(tokenResolverProvider.getIfAvailable()).thenReturn(tokenResolver);
        when(client.withOptions(any())).thenReturn(sessionClient);
        when(sessionClient.roles()).thenReturn(roles);
        when(roles.assignments()).thenReturn(assignments);
        when(store.find(any())).thenReturn(Optional.empty());
        service = new EcpRequestOperatorService(
            client, store, mapper, tokenResolverProvider, identityService);
    }

    @Test
    void refreshesAndPersistsOperatorsWithTheAuthorizedUserSession() {
        ApplicationRole appAdmin = role(1L, "APP_ADMIN", "APP_ADMIN", List.of("asset:request:review"));
        ApplicationRole operator = role(2L, "OPERATOR", "OPERATOR", List.of("asset:request:review"));
        ApplicationRole auditor = role(3L, "APP_AUDITOR", "AUDITOR", List.of("asset:request:view"));
        ApplicationRoleAssignment first = assignment("account:user-1", "管理员甲");
        ApplicationRoleAssignment duplicate = assignment("account:user-1", "管理员甲");
        ApplicationRoleAssignment second = assignment("account:user-2", "管理员乙");
        MockHttpServletRequest request = new MockHttpServletRequest();
        when(identityService.current(request)).thenReturn(Optional.of(identity("super_admin", Set.of())));
        when(tokenResolver.resolveSessionToken(request)).thenReturn("Bearer session-token");
        when(roles.list()).thenReturn(List.of(appAdmin, operator, auditor));
        when(assignments.list(null, 1L)).thenReturn(List.of(first));
        when(assignments.list(null, 2L)).thenReturn(List.of(duplicate, second));

        assertThat(service.list(request))
            .extracting(EcpRequestOperatorService.RequestOperator::subject,
                EcpRequestOperatorService.RequestOperator::name)
            .containsExactly(
                org.assertj.core.groups.Tuple.tuple("user-1", "管理员甲"),
                org.assertj.core.groups.Tuple.tuple("user-2", "管理员乙"));

        ArgumentCaptor<EcpRequestOptions> options = ArgumentCaptor.forClass(EcpRequestOptions.class);
        verify(client).withOptions(options.capture());
        assertThat(options.getValue().getHeaders()).containsEntry("Authorization", "Bearer session-token");
        verify(store).saveAll(any());
    }

    @Test
    void ordinaryEmployeesReadThePersistedSnapshotWithoutRoleManagementAccess() {
        EcpRequestOperatorService.RequestOperator persisted =
            new EcpRequestOperatorService.RequestOperator("user-2", "管理员乙", "示例公司", "信息部");
        when(store.find(any())).thenReturn(Optional.of(new AppStoreRepository.StoreValue(
            mapper.valueToTree(List.of(persisted)), Instant.now())));
        MockHttpServletRequest request = new MockHttpServletRequest();
        when(identityService.current(request)).thenReturn(Optional.of(identity("employee", Set.of("asset:request:create"))));

        assertThat(service.list(request)).containsExactly(persisted);

        verify(client, never()).withOptions(any());
        verify(tokenResolver, never()).resolveSessionToken(any());
    }

    private RequestIdentityService.Identity identity(String roleCode, Set<String> permissions) {
        return new RequestIdentityService.Identity(
            "测试用户", "test@example.com", "user-1", "user-1", "tenant-1",
            "信息部", "示例公司", Set.of("department-1"), roleCode, permissions);
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

    private ApplicationRoleAssignment assignment(String subject, String label) {
        ApplicationRoleAssignment assignment = mock(ApplicationRoleAssignment.class);
        when(assignment.subjectType()).thenReturn("ACCOUNT");
        when(assignment.subjectKey()).thenReturn(subject);
        when(assignment.subjectLabel()).thenReturn(label);
        when(assignment.companyName()).thenReturn("示例公司");
        when(assignment.departmentName()).thenReturn("信息部");
        return assignment;
    }
}
