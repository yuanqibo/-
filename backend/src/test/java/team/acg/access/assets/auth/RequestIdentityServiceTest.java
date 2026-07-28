package team.acg.access.assets.auth;

import com.idanchuang.ecp.sdk.spring.session.DefaultSessionTokenResolver;
import com.idanchuang.ecp.sdk.spring.session.SessionTokenResolver;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.server.ResponseStatusException;
import team.acg.access.assets.ecp.EcpSecurityPolicy;

import java.util.List;
import java.util.Map;
import java.util.Set;

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
            "permissionCodes", List.of("asset:item:view", "asset:item:receive")));
        EcpSecurityPolicy policy = mock(EcpSecurityPolicy.class);
        when(policy.tenantId()).thenReturn("tenant-1");
        when(policy.tenantRestrictionEnabled()).thenReturn(true);
        RequestIdentityService service = service(provider, policy);
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("Authorization", "Bearer valid-token");

        assertThat(service.current(request).orElseThrow().name()).isEqualTo("李雷");
        assertThat(service.current(request).orElseThrow().tenantId()).isEqualTo("tenant-1");
        verify(ecp, times(1)).resolve("valid-token");
        assertThat(service.trustedName(request, "伪造姓名")).isEqualTo("李雷");
        assertThatThrownBy(() -> service.requirePermission(request, "asset:item:delete"))
            .isInstanceOf(ResponseStatusException.class)
            .hasMessageContaining("403 FORBIDDEN");
        service.requireAnyPermission(request, Set.of("asset:item:receive", "asset:receive_return:receive"));
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
        when(policy.tenantRestrictionEnabled()).thenReturn(true);
        RequestIdentityService service = service(provider, policy);
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
        when(policy.tenantRestrictionEnabled()).thenReturn(true);
        RequestIdentityService service = service(provider, policy);
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
    void acceptsAnyEcpTenantWhenNoDeploymentTenantRestrictionIsConfigured() {
        ObjectProvider<EcpIdentityService> provider = mock(ObjectProvider.class);
        EcpIdentityService ecp = mock(EcpIdentityService.class);
        when(provider.getIfAvailable()).thenReturn(ecp);
        when(ecp.resolve("valid-token")).thenReturn(Map.of(
            "name", "韩梅梅", "account", "hanmeimei", "tenantId", "tenant-2",
            "subject", "account-2", "directorySubject", "user-2",
            "permissionCodes", List.of("asset:item:view")));
        EcpSecurityPolicy policy = mock(EcpSecurityPolicy.class);
        when(policy.tenantRestrictionEnabled()).thenReturn(false);
        RequestIdentityService service = service(provider, policy);

        assertThat(service.current(requestWithToken("valid-token")).orElseThrow().tenantId()).isEqualTo("tenant-2");
    }

    @Test
    @SuppressWarnings("unchecked")
    void requiresBearerTokenWhenEcpIsEnabled() {
        ObjectProvider<EcpIdentityService> provider = mock(ObjectProvider.class);
        when(provider.getIfAvailable()).thenReturn(mock(EcpIdentityService.class));
        RequestIdentityService service = service(provider, mock(EcpSecurityPolicy.class));

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

        RequestIdentityService service = service(provider, policy);

        assertThatThrownBy(() -> service.current(new MockHttpServletRequest()))
            .isInstanceOf(ResponseStatusException.class)
            .hasMessageContaining("503 SERVICE_UNAVAILABLE");
    }

    @Test
    @SuppressWarnings("unchecked")
    void resolvesTheSessionTokenThroughTheEcpSdkResolver() {
        ObjectProvider<EcpIdentityService> identityProvider = mock(ObjectProvider.class);
        EcpIdentityService ecp = mock(EcpIdentityService.class);
        when(identityProvider.getIfAvailable()).thenReturn(ecp);
        when(ecp.resolve("sdk-session-token")).thenReturn(Map.of(
            "name", "李雷", "account", "lilei", "tenantId", "tenant-1",
            "subject", "account-1", "directorySubject", "user-1",
            "permissionCodes", List.of("asset:item:view")));
        ObjectProvider<SessionTokenResolver> tokenProvider = mock(ObjectProvider.class);
        SessionTokenResolver resolver = mock(SessionTokenResolver.class);
        when(tokenProvider.getIfAvailable()).thenReturn(resolver);
        MockHttpServletRequest request = new MockHttpServletRequest();
        when(resolver.resolveSessionToken(request)).thenReturn("sdk-session-token");

        RequestIdentityService service = new RequestIdentityService(
            identityProvider, tokenProvider, mock(EcpSecurityPolicy.class));

        assertThat(service.current(request).orElseThrow().account()).isEqualTo("lilei");
        verify(resolver).resolveSessionToken(request);
        verify(ecp).resolve("sdk-session-token");
    }

    @Test
    @SuppressWarnings("unchecked")
    void letsAnAuthoritativelyReconciledSuperAdminUseAllPortalPermissions() {
        ObjectProvider<EcpIdentityService> provider = mock(ObjectProvider.class);
        EcpIdentityService ecp = mock(EcpIdentityService.class);
        when(provider.getIfAvailable()).thenReturn(ecp);
        when(ecp.resolve("admin-token")).thenReturn(Map.of(
            "name", "袁其博", "account", "yuanqibo@accesscorporate.com.cn", "tenantId", "tenant-1",
            "subject", "account-1", "directorySubject", "vlbe8nyybl35d17u",
            "roleCode", "super_admin", "permissionCodes", List.of("asset:item:view")));
        RequestIdentityService service = service(provider, mock(EcpSecurityPolicy.class));
        RequestIdentityService.Identity identity = service.current(requestWithToken("admin-token")).orElseThrow();

        assertThat(identity.hasPermission("asset:item:delete")).isTrue();
        assertThat(identity.hasAnyPermission(Set.of("authz:app_role:assign"))).isTrue();
    }

    private MockHttpServletRequest requestWithToken(String token) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("Authorization", "Bearer " + token);
        return request;
    }

    @SuppressWarnings("unchecked")
    private RequestIdentityService service(ObjectProvider<EcpIdentityService> identityProvider,
                                           EcpSecurityPolicy policy) {
        ObjectProvider<SessionTokenResolver> tokenProvider = mock(ObjectProvider.class);
        when(tokenProvider.getIfAvailable()).thenReturn(new DefaultSessionTokenResolver());
        return new RequestIdentityService(identityProvider, tokenProvider, policy);
    }
}
