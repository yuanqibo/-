package team.acg.access.assets.ecp;

import com.idanchuang.ecp.sdk.client.exception.EcpAuthenticationException;
import com.idanchuang.ecp.sdk.spring.security.PermissionDecisionResult;
import com.idanchuang.ecp.sdk.spring.security.PermissionDecisionService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
import java.util.Map;

import team.acg.access.assets.auth.EcpIdentityService;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@Import(EcpPermissionAspectIntegrationTest.PermissionTestConfiguration.class)
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:permission-test;MODE=MySQL;DB_CLOSE_DELAY=-1",
    "ecp.sdk.enabled=true",
    "ecp.sdk.app-code=WLY5YG",
    "ecp.sdk.app-secret=test-app-secret",
    "ecp.sdk.permission.snapshot-signing-secret=test-snapshot-secret",
    "asset-portal.security.tenant-id=tenant-test",
    "asset-portal.system-config.encryption-key=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="
})
class EcpPermissionAspectIntegrationTest {
    @Autowired MockMvc mvc;

    @Test
    void requiresABearerSessionForAnnotatedEndpoints() throws Exception {
        mvc.perform(get("/api/store/item").param("key", "assetLabelCustomTemplatesV1"))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.error").value("ECP bearer token is required"));
    }

    @Test
    void rejectsCrossTenantIdentityBeforeAnAnnotatedDatabaseEndpointRuns() throws Exception {
        mvc.perform(get("/api/store/item").param("key", "assetLabelCustomTemplatesV1")
                .header("Authorization", "Bearer cross-tenant-token"))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error").value("ECP tenant is not allowed for this deployment"));
    }

    @Test
    void mapsPermissionDenialsToForbidden() throws Exception {
        mvc.perform(get("/api/store/item").param("key", "assetLabelCustomTemplatesV1")
                .header("Authorization", "Bearer denied-token"))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.requiredPermissionCodes[0]").value("asset:label_template_settings:view"));
    }

    @Test
    void permitsRequestsWhenTheSignedDecisionLayerAllowsThem() throws Exception {
        mvc.perform(get("/api/store/item").param("key", "assetLabelCustomTemplatesV1")
                .header("Authorization", "Bearer allow-token"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.found").value(true))
            .andExpect(jsonPath("$.value").isArray());
    }

    @TestConfiguration
    static class PermissionTestConfiguration {
        @Bean
        PermissionDecisionService permissionDecisionService() {
            return request -> {
                String token = request.context().sessionToken();
                if (token == null || token.isBlank()) throw new EcpAuthenticationException("Missing session token");
                if ("allow-token".equals(token)) {
                    return PermissionDecisionResult.allowed(List.of(request.permissionCode()));
                }
                return PermissionDecisionResult.denied(
                    List.of(), List.of(request.permissionCode()), "TEST", "MISSING_PERMISSION");
            };
        }

        @Bean
        @Primary
        EcpIdentityService testEcpIdentityService() {
            EcpIdentityService service = mock(EcpIdentityService.class);
            when(service.resolve(anyString())).thenAnswer(invocation -> {
                String token = invocation.getArgument(0, String.class);
                String tenantId = "cross-tenant-token".equals(token) ? "tenant-other" : "tenant-test";
                return Map.of(
                    "name", "测试用户",
                    "account", "test-user",
                    "subject", "account-subject-test-user",
                    "directorySubject", "directory-subject-test-user",
                    "tenantId", tenantId,
                    "roleCode", "admin",
                    "permissionCodes", List.of("asset:label_template_settings:view"));
            });
            return service;
        }
    }
}
