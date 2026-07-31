package team.acg.access.assets.ecp;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletRequest;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;

import team.acg.access.assets.auth.EcpIdentityService;
import team.acg.access.assets.auth.RequestIdentityService;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class EcpProxyControllerTest {
    private HttpServer upstream;
    private EcpProxyController controller;
    private RequestIdentityService identityService;
    private EcpIdentityService identityCache;
    private final AtomicReference<String> forwardedAuthorization = new AtomicReference<>();
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
            byte[] body = "{\"loginMethods\":[\"FEISHU\",\"EMAIL_PASSWORD\"]}".getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        upstream.createContext("/applications/WLY5YG/app-roles", exchange -> {
            byte[] body = "[]".getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        upstream.createContext("/applications/WLY5YG/app-role-assignments", exchange -> {
            forwardedPath.set(exchange.getRequestURI().getPath());
            byte[] requestBody = exchange.getRequestBody().readAllBytes();
            forwardedAuthorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
            forwardedBody.set(new String(requestBody, StandardCharsets.UTF_8));
            byte[] body = requestBody.length == 0
                ? "[]".getBytes(StandardCharsets.UTF_8)
                : "{\"id\":11,\"appRoleId\":1,\"subjectKey\":\"account:user-1\"}"
                    .getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        upstream.createContext("/applications/WLY5YG/app-role-assignment-subjects", exchange -> {
            forwardedPath.set(exchange.getRequestURI().getPath());
            forwardedAuthorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
            forwardedBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            byte[] body = "{\"subjectKey\":\"account:user-1\",\"assignmentCount\":1}"
                .getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        upstream.start();
        ObjectProvider<EcpIdentityService> identityCacheProvider = mock(ObjectProvider.class);
        identityCache = mock(EcpIdentityService.class);
        identityService = mock(RequestIdentityService.class);
        when(identityCacheProvider.getIfAvailable()).thenReturn(identityCache);
        controller = new EcpProxyController("http://127.0.0.1:" + upstream.getAddress().getPort(), "WLY5YG",
            identityCacheProvider, identityService);
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
    void forwardsRoleAssignmentWritesToTheEmbeddedWorkspaceEndpointWithTheOperatorSession() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest(
            "PUT", "/api/v1/applications/WLY5YG/app-role-assignment-subjects");
        request.addHeader("Authorization", "Bearer session-token");
        request.setContentType("application/json");
        request.setContent("{\"subjectType\":\"ACCOUNT\",\"subjectKey\":\"account:user-1\",\"appRoleIds\":[1]}"
            .getBytes(StandardCharsets.UTF_8));

        ResponseEntity<byte[]> response = controller.proxy(request);

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(new String(response.getBody(), StandardCharsets.UTF_8)).contains("account:user-1", "assignmentCount");
        assertThat(forwardedPath).hasValue("/applications/WLY5YG/app-role-assignment-subjects");
        assertThat(forwardedAuthorization).hasValue("Bearer session-token");
        assertThat(forwardedBody.get()).contains("account:user-1", "appRoleIds");
        verify(identityService).requirePermission(request, "authz:app_role:assign");
        verify(identityCache).invalidateAll();
    }

    @Test
    void forwardsRoleAssignmentCreatesToTheEmbeddedWorkspaceEndpoint() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest(
            "POST", "/api/v1/applications/WLY5YG/app-role-assignments");
        request.addHeader("Authorization", "Bearer session-token");
        request.setContentType("application/json");
        request.setContent(("{\"appRoleId\":1,\"subjectType\":\"ACCOUNT\"," +
            "\"subjectKey\":\"account:user-1\"}").getBytes(StandardCharsets.UTF_8));

        ResponseEntity<byte[]> response = controller.proxy(request);

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(forwardedPath).hasValue("/applications/WLY5YG/app-role-assignments");
        assertThat(forwardedAuthorization).hasValue("Bearer session-token");
        verify(identityService).requirePermission(request, "authz:app_role:assign");
        verify(identityCache).invalidateAll();
    }

    @Test
    void keepsRoleAssignmentReadsOnTheStandardEndpoint() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest(
            "GET", "/api/v1/applications/WLY5YG/app-role-assignments");

        ResponseEntity<byte[]> response = controller.proxy(request);

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(forwardedPath).hasValue("/applications/WLY5YG/app-role-assignments");
    }
}
