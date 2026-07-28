package team.acg.access.assets.ecp;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.idanchuang.ecp.api.common.model.role.ApplicationRoleAssignmentSubjectSummary;
import com.idanchuang.ecp.sdk.client.EcpClient;
import com.idanchuang.ecp.sdk.client.operation.AssignmentsOperations;
import com.idanchuang.ecp.sdk.client.operation.RolesOperations;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletRequest;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;

import team.acg.access.assets.auth.RequestIdentityService;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class EcpProxyControllerTest {
    private HttpServer upstream;
    private EcpProxyController controller;
    private EcpClient ecpClient;
    private RequestIdentityService identityService;
    private AssignmentsOperations assignments;
    private ObjectProvider<EcpClient> ecpClientProvider;

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
        upstream.start();
        ecpClient = mock(EcpClient.class);
        ecpClientProvider = mock(ObjectProvider.class);
        identityService = mock(RequestIdentityService.class);
        RolesOperations roles = mock(RolesOperations.class);
        assignments = mock(AssignmentsOperations.class);
        when(ecpClient.roles()).thenReturn(roles);
        when(ecpClientProvider.getIfAvailable()).thenReturn(ecpClient);
        when(roles.assignments()).thenReturn(assignments);
        controller = new EcpProxyController("http://127.0.0.1:" + upstream.getAddress().getPort(), "WLY5YG",
            ecpClientProvider, identityService, new ObjectMapper());
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
    void executesRoleAssignmentWritesWithTheApplicationSdkAfterAuthorizingTheOperator() throws Exception {
        var summary = new ApplicationRoleAssignmentSubjectSummary(
            "ACCOUNT", "account:user-1", "测试用户", List.of(1L), List.of(9L), 1);
        when(assignments.syncSubjects(any())).thenReturn(summary);
        MockHttpServletRequest request = new MockHttpServletRequest(
            "PUT", "/api/v1/applications/WLY5YG/app-role-assignment-subjects");
        request.addHeader("Authorization", "Bearer session-token");
        request.setContentType("application/json");
        request.setContent("{\"subjectType\":\"ACCOUNT\",\"subjectKey\":\"account:user-1\",\"appRoleIds\":[1]}"
            .getBytes(StandardCharsets.UTF_8));

        ResponseEntity<byte[]> response = controller.proxy(request);

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(new String(response.getBody(), StandardCharsets.UTF_8)).contains("account:user-1", "assignmentCount");
        verify(identityService).requirePermission(request, "authz:app_role:assign");
        verify(assignments).syncSubjects(any());
    }
}
