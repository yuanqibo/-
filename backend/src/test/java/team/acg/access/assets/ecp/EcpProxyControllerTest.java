package team.acg.access.assets.ecp;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletRequest;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;

import static org.assertj.core.api.Assertions.assertThat;

class EcpProxyControllerTest {
    private HttpServer upstream;
    private EcpProxyController controller;

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
        controller = new EcpProxyController("http://127.0.0.1:" + upstream.getAddress().getPort(), "WLY5YG");
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
}
