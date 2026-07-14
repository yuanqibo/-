package team.acg.access.assets.auth;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Map;
import team.acg.access.assets.ecp.EcpSecurityPolicy;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class RequestIdentityServiceTest {
    @Test
    @SuppressWarnings("unchecked")
    void resolvesTrustedIdentityAndRejectsMissingPermission() {
        ObjectProvider<EcpIdentityService> provider = mock(ObjectProvider.class);
        EcpIdentityService ecp = mock(EcpIdentityService.class);
        when(provider.getIfAvailable()).thenReturn(ecp);
        when(ecp.resolve("valid-token")).thenReturn(Map.of(
            "name", "李雷", "account", "lilei", "department", "销售部", "roleCode", "employee",
            "tenantId", "tenant-1",
            "subject", "account-1", "directorySubject", "user-1",
            "permissionCodes", List.of("asset:item:view")));
        EcpSecurityPolicy policy = mock(EcpSecurityPolicy.class);
        when(policy.tenantId()).thenReturn("tenant-1");
        RequestIdentityService service = new RequestIdentityService(provider, policy);
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("Authorization", "Bearer valid-token");

        assertThat(service.current(request).orElseThrow().name()).isEqualTo("李雷");
        assertThat(service.current(request).orElseThrow().tenantId()).isEqualTo("tenant-1");
        verify(ecp, times(1)).resolve("valid-token");
        assertThat(service.trustedName(request, "伪造姓名")).isEqualTo("李雷");
        assertThatThrownBy(() -> service.requirePermission(request, "asset:item:delete"))
            .isInstanceOf(ResponseStatusException.class)
            .hasMessageContaining("403 FORBIDDEN");
    }

    @Test
    @SuppressWarnings("unchecked")
    void rejectsIdentityWithoutTenantAndDoesNotCacheIt() {
        ObjectProvider<EcpIdentityService> provider = mock(ObjectProvider.class);
        EcpIdentityService ecp = mock(EcpIdentityService.class);
        when(provider.getIfAvailable()).thenReturn(ecp);
        when(ecp.resolve("missing-tenant")).thenReturn(Map.of(
            "name", "李雷", "account", "lilei", "permissionCodes", List.of("asset:item:view")));
        EcpSecurityPolicy policy = mock(EcpSecurityPolicy.class);
        when(policy.tenantId()).thenReturn("tenant-1");
        RequestIdentityService service = new RequestIdentityService(provider, policy);
        MockHttpServletRequest request = requestWithToken("missing-tenant");

        assertThatThrownBy(() -> service.current(request))
            .isInstanceOf(ResponseStatusException.class)
            .hasMessageContaining("401 UNAUTHORIZED");
        assertThatThrownBy(() -> service.current(request))
            .isInstanceOf(ResponseStatusException.class)
            .hasMessageContaining("401 UNAUTHORIZED");
        verify(ecp, times(2)).resolve("missing-tenant");
    }

    @Test
    @SuppressWarnings("unchecked")
    void rejectsCrossTenantIdentityAndDoesNotCacheIt() {
        ObjectProvider<EcpIdentityService> provider = mock(ObjectProvider.class);
        EcpIdentityService ecp = mock(EcpIdentityService.class);
        when(provider.getIfAvailable()).thenReturn(ecp);
        when(ecp.resolve("other-tenant")).thenReturn(Map.of(
            "name", "韩梅梅", "account", "hanmeimei", "tenantId", "tenant-2",
            "subject", "account-2", "directorySubject", "user-2",
            "permissionCodes", List.of("asset:item:view")));
        EcpSecurityPolicy policy = mock(EcpSecurityPolicy.class);
        when(policy.tenantId()).thenReturn("tenant-1");
        RequestIdentityService service = new RequestIdentityService(provider, policy);
        MockHttpServletRequest request = requestWithToken("other-tenant");

        assertThatThrownBy(() -> service.current(request))
            .isInstanceOf(ResponseStatusException.class)
            .hasMessageContaining("403 FORBIDDEN");
        assertThatThrownBy(() -> service.current(request))
            .isInstanceOf(ResponseStatusException.class)
            .hasMessageContaining("403 FORBIDDEN");
        verify(ecp, times(2)).resolve("other-tenant");
    }

    @Test
    @SuppressWarnings("unchecked")
    void requiresBearerTokenWhenEcpIsEnabled() {
        ObjectProvider<EcpIdentityService> provider = mock(ObjectProvider.class);
        when(provider.getIfAvailable()).thenReturn(mock(EcpIdentityService.class));
        RequestIdentityService service = new RequestIdentityService(provider, mock(EcpSecurityPolicy.class));

        assertThatThrownBy(() -> service.current(new MockHttpServletRequest()))
            .isInstanceOf(ResponseStatusException.class)
            .hasMessageContaining("401 UNAUTHORIZED");
    }

    @Test
    @SuppressWarnings("unchecked")
    void failsClosedWhenEcpIdentityServiceIsUnavailable() {
        ObjectProvider<EcpIdentityService> provider = mock(ObjectProvider.class);
        EcpSecurityPolicy policy = mock(EcpSecurityPolicy.class);
        when(provider.getIfAvailable()).thenReturn(null);
        when(policy.testBypassEnabled()).thenReturn(false);

        RequestIdentityService service = new RequestIdentityService(provider, policy);

        assertThatThrownBy(() -> service.current(new MockHttpServletRequest()))
            .isInstanceOf(ResponseStatusException.class)
            .hasMessageContaining("503 SERVICE_UNAVAILABLE");
    }

    private MockHttpServletRequest requestWithToken(String token) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("Authorization", "Bearer " + token);
        return request;
    }
}
