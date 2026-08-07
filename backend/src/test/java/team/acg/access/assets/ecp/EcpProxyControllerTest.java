package team.acg.access.assets.ecp;

import com.idanchuang.ecp.sdk.spring.session.SessionTokenResolver;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.server.ResponseStatusException;
import team.acg.access.assets.auth.EcpIdentityService;
import team.acg.access.assets.auth.RequestIdentityService;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class EcpProxyControllerTest {
    private HttpServer upstream;
    private EcpProxyController controller;
    private RequestIdentityService identityService;
    private EcpIdentityService identityCache;
    private EcpRequestOperatorService requestOperators;
    private SessionTokenResolver sessionTokenResolver;
    private final AtomicReference<String> forwardedAuthorization = new AtomicReference<>();
    private final AtomicReference<String> forwardedTenantId = new AtomicReference<>();
    private final AtomicReference<String> forwardedUserId = new AtomicReference<>();
    private final AtomicReference<String> forwardedRequestId = new AtomicReference<>();
    private final AtomicReference<String> forwardedBody = new AtomicReference<>();
    private final AtomicReference<String> forwardedPath = new AtomicReference<>();

    @BeforeEach
    void startUpstream() throws Exception {
        upstream = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        upstream.createContext("/public/login/apps/WLY5YG", exchange -> {
            if (!"identity".equals(exchange.getRequestHeaders().getFirst("Accept-Encoding"))) {
                exchange.sendResponseHeaders(400, -1);
                exchange.close();
                return;
            }
            respond(exchange, "{\"loginMethods\":[\"FEISHU\",\"EMAIL_PASSWORD\"]}");
        });
        upstream.createContext("/applications/WLY5YG/app-roles", exchange -> respond(exchange, "[]"));
        upstream.createContext("/applications/WLY5YG/app-role-assignments", exchange -> {
            captureRequest(exchange);
            String response = forwardedBody.get().isBlank()
                ? "[]"
                : "{\"id\":11,\"appRoleId\":1,\"subjectKey\":\"account:user-1\"}";
            respond(exchange, response);
        });
        upstream.createContext("/applications/WLY5YG/app-role-assignment-subjects", exchange -> {
            captureRequest(exchange);
            respond(exchange, "{\"subjectKey\":\"account:user-1\",\"assignmentCount\":1}");
        });
        upstream.createContext("/applications/WLY5YG/app-role-assignments/batch-remove", exchange -> {
            captureRequest(exchange);
            respond(exchange, "{\"removedIds\":[11]}");
        });
        upstream.start();

        ObjectProvider<SessionTokenResolver> sessionTokenResolverProvider = mock(ObjectProvider.class);
        ObjectProvider<EcpIdentityService> identityCacheProvider = mock(ObjectProvider.class);
        ObjectProvider<EcpRequestOperatorService> requestOperatorsProvider = mock(ObjectProvider.class);
        identityCache = mock(EcpIdentityService.class);
        requestOperators = mock(EcpRequestOperatorService.class);
        identityService = mock(RequestIdentityService.class);
        sessionTokenResolver = mock(SessionTokenResolver.class);
        when(sessionTokenResolverProvider.getIfAvailable()).thenReturn(sessionTokenResolver);
        when(sessionTokenResolver.resolveSessionToken(any())).thenReturn("Bearer session-token");
        when(identityCacheProvider.getIfAvailable()).thenReturn(identityCache);
        when(requestOperatorsProvider.getIfAvailable()).thenReturn(requestOperators);
        controller = new EcpProxyController(
            "http://127.0.0.1:" + upstream.getAddress().getPort(),
            "WLY5YG",
            sessionTokenResolverProvider,
            identityCacheProvider,
            requestOperatorsProvider,
            identityService);
    }

    @AfterEach
    void stopUpstream() {
        upstream.stop(0);
    }

    @Test
    void proxiesLoginConfigurationWithoutHttp2PseudoHeaders() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/public/login/apps/WLY5YG");
        request.setServerName("assets.example.test");
        request.setServerPort(443);
        request.setScheme("https");
        request.addHeader("Accept-Encoding", "gzip, br");

        ResponseEntity<byte[]> response = controller.proxy(request);

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(response.getHeaders().keySet()).noneMatch(name -> name.startsWith(":"));
        assertThat(new String(response.getBody(), StandardCharsets.UTF_8)).contains("EMAIL_PASSWORD");
    }

    @Test
    void proxiesTheCurrentApplicationsPublicWorkspaceContract() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/applications/WLY5YG/app-roles");

        ResponseEntity<byte[]> response = controller.proxy(request);

        assertThat(response.getStatusCode().value()).isEqualTo(200);
    }

    @Test
    void rejectsApplicationPathsOutsideTheWorkspaceContract() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/applications/WLY5YG/secrets");

        ResponseEntity<byte[]> response = controller.proxy(request);

        assertThat(response.getStatusCode().value()).isEqualTo(404);
    }

    @Test
    void rejectsLoginRequestsForAnotherApplication() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/public/login/apps/OTHER_APP");

        ResponseEntity<byte[]> response = controller.proxy(request);

        assertThat(response.getStatusCode().value()).isEqualTo(404);
    }

    @Test
    void rejectsForeignApplicationCodesInPublicEndpointQueries() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/public/login/apps/WLY5YG");
        request.setQueryString("appCode=OTHER_APP");

        ResponseEntity<byte[]> response = controller.proxy(request);

        assertThat(response.getStatusCode().value()).isEqualTo(400);
    }

    @Test
    void acceptsTheBoundApplicationCodeInPublicEndpointQueries() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/public/login/apps/WLY5YG");
        request.setQueryString("appCode=WLY5YG");

        ResponseEntity<byte[]> response = controller.proxy(request);

        assertThat(response.getStatusCode().value()).isEqualTo(200);
    }

    @Test
    void forwardsRoleAssignmentSyncWithTheCurrentUserSessionAndRequestContext() throws Exception {
        MockHttpServletRequest request = roleMutationRequest(
            "PUT",
            "/api/v1/applications/WLY5YG/app-role-assignment-subjects",
            "{\"subjectType\":\"ACCOUNT\",\"subjectKey\":\"account:user-1\",\"appRoleIds\":[1]}");

        ResponseEntity<byte[]> response = controller.proxy(request);

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(new String(response.getBody(), StandardCharsets.UTF_8))
            .contains("account:user-1", "assignmentCount");
        assertForwardedMutation("/applications/WLY5YG/app-role-assignment-subjects");
        assertThat(forwardedBody.get()).contains("account:user-1", "appRoleIds");
        verify(identityService).requirePermission(request, "authz:app_role:assign");
        verify(identityCache).invalidateAll();
        verify(requestOperators).refresh("session-token");
    }

    @Test
    void forwardsRoleAssignmentCreateWithTheCurrentUserSessionAndRequestContext() throws Exception {
        MockHttpServletRequest request = roleMutationRequest(
            "POST",
            "/api/v1/applications/WLY5YG/app-role-assignments",
            "{\"appRoleId\":1,\"subjectType\":\"ACCOUNT\",\"subjectKey\":\"account:user-1\"}");

        ResponseEntity<byte[]> response = controller.proxy(request);

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(new String(response.getBody(), StandardCharsets.UTF_8)).contains("account:user-1", "appRoleId");
        assertForwardedMutation("/applications/WLY5YG/app-role-assignments");
        assertThat(forwardedBody.get()).contains("account:user-1", "appRoleId");
        verify(identityService).requirePermission(request, "authz:app_role:assign");
        verify(identityCache).invalidateAll();
        verify(requestOperators).refresh("session-token");
    }

    @Test
    void forwardsRoleAssignmentRemovalWithTheCurrentUserSessionAndRequestContext() throws Exception {
        MockHttpServletRequest request = roleMutationRequest(
            "POST",
            "/api/v1/applications/WLY5YG/app-role-assignments/batch-remove",
            "{\"assignmentIds\":[11]}");

        ResponseEntity<byte[]> response = controller.proxy(request);

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(new String(response.getBody(), StandardCharsets.UTF_8)).contains("removedIds", "11");
        assertForwardedMutation("/applications/WLY5YG/app-role-assignments/batch-remove");
        assertThat(forwardedBody.get()).contains("assignmentIds", "11");
        verify(identityService).requirePermission(request, "authz:app_role:assign");
        verify(identityCache).invalidateAll();
        verify(requestOperators).refresh("session-token");
    }

    @Test
    void rejectsRoleMutationWhenTheCurrentUserSessionIsMissing() {
        when(sessionTokenResolver.resolveSessionToken(any())).thenReturn(" ");
        MockHttpServletRequest request = roleMutationRequest(
            "POST",
            "/api/v1/applications/WLY5YG/app-role-assignments",
            "{\"appRoleId\":1,\"subjectType\":\"ACCOUNT\",\"subjectKey\":\"account:user-1\"}");

        assertThatThrownBy(() -> controller.proxy(request))
            .isInstanceOf(ResponseStatusException.class)
            .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode().value()).isEqualTo(401));

        assertThat(forwardedPath.get()).isNull();
        verify(identityService).requirePermission(request, "authz:app_role:assign");
        verify(identityCache, never()).invalidateAll();
        verify(requestOperators, never()).refresh(any());
    }

    @Test
    void keepsRoleAssignmentReadsOnTheStandardEndpoint() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest(
            "GET", "/api/v1/applications/WLY5YG/app-role-assignments");

        ResponseEntity<byte[]> response = controller.proxy(request);

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(forwardedPath).hasValue("/applications/WLY5YG/app-role-assignments");
    }

    private MockHttpServletRequest roleMutationRequest(String method, String path, String body) {
        MockHttpServletRequest request = new MockHttpServletRequest(method, path);
        request.addHeader("Authorization", "Bearer stale-application-token");
        request.addHeader("X-Tenant-Id", "tenant-1");
        request.addHeader("X-User-Id", "user-1");
        request.addHeader("X-Request-Id", "request-1");
        request.setContentType("application/json");
        request.setContent(body.getBytes(StandardCharsets.UTF_8));
        return request;
    }

    private void assertForwardedMutation(String path) {
        assertThat(forwardedPath).hasValue(path);
        assertThat(forwardedAuthorization).hasValue("Bearer session-token");
        assertThat(forwardedTenantId).hasValue("tenant-1");
        assertThat(forwardedUserId).hasValue("user-1");
        assertThat(forwardedRequestId).hasValue("request-1");
    }

    private void captureRequest(HttpExchange exchange) throws IOException {
        forwardedPath.set(exchange.getRequestURI().getPath());
        forwardedAuthorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
        forwardedTenantId.set(exchange.getRequestHeaders().getFirst("X-Tenant-Id"));
        forwardedUserId.set(exchange.getRequestHeaders().getFirst("X-User-Id"));
        forwardedRequestId.set(exchange.getRequestHeaders().getFirst("X-Request-Id"));
        forwardedBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
    }

    private void respond(HttpExchange exchange, String response) throws IOException {
        byte[] body = response.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().add("Content-Type", "application/json");
        exchange.sendResponseHeaders(200, body.length);
        exchange.getResponseBody().write(body);
        exchange.close();
    }
}
