package team.acg.access.assets.auth;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
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
            "permissionCodes", List.of("asset:view")));
        RequestIdentityService service = new RequestIdentityService(provider);
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("Authorization", "Bearer valid-token");

        assertThat(service.current(request).orElseThrow().name()).isEqualTo("李雷");
        assertThat(service.trustedName(request, "伪造姓名")).isEqualTo("李雷");
        assertThatThrownBy(() -> service.requirePermission(request, "asset:delete"))
            .isInstanceOf(ResponseStatusException.class)
            .hasMessageContaining("403 FORBIDDEN");
    }

    @Test
    @SuppressWarnings("unchecked")
    void requiresBearerTokenWhenEcpIsEnabled() {
        ObjectProvider<EcpIdentityService> provider = mock(ObjectProvider.class);
        when(provider.getIfAvailable()).thenReturn(mock(EcpIdentityService.class));
        RequestIdentityService service = new RequestIdentityService(provider);

        assertThatThrownBy(() -> service.current(new MockHttpServletRequest()))
            .isInstanceOf(ResponseStatusException.class)
            .hasMessageContaining("401 UNAUTHORIZED");
    }
}
