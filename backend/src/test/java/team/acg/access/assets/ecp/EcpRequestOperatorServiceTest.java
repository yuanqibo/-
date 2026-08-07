package team.acg.access.assets.ecp;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.idanchuang.ecp.sdk.spring.session.SessionTokenResolver;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.mock.web.MockHttpServletRequest;
import team.acg.access.assets.auth.RequestIdentityService;
import team.acg.access.assets.store.AppStoreRepository;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class EcpRequestOperatorServiceTest {
    private HttpServer upstream;
    private final AtomicReference<String> authorization = new AtomicReference<>();
    private final AtomicInteger upstreamRequests = new AtomicInteger();
    private AppStoreRepository store;
    private ObjectMapper mapper;
    private SessionTokenResolver tokenResolver;
    private RequestIdentityService identityService;
    private EcpRequestOperatorService service;

    @BeforeEach
    void setUp() throws IOException {
        upstream = HttpServer.create(new InetSocketAddress(0), 0);
        upstream.createContext("/api/v1/applications/WLY5YG/app-roles", exchange -> respond(exchange, """
            {"data":{"items":[
              {"id":1,"code":"APP_ADMIN","roleTypeCode":"APP_ADMIN","status":"enabled","effectivePermissionCodes":["asset:request:review"]},
              {"id":2,"code":"OPERATOR","roleTypeCode":"OPERATOR","status":"enabled","effectivePermissionCodes":["asset:request:review"]},
              {"id":3,"code":"APP_AUDITOR","roleTypeCode":"AUDITOR","status":"enabled","effectivePermissionCodes":["asset:request:view"]}
            ]}}
            """));
        upstream.createContext("/api/v1/applications/WLY5YG/app-role-assignments", exchange -> {
            String query = exchange.getRequestURI().getRawQuery();
            String response = query != null && query.contains("appRoleId=1") ? """
                {"assignments":[
                  {"subjectType":"ACCOUNT","subjectKey":"account:user-1","subjectLabel":"管理员甲","companyName":"示例公司","departmentName":"信息部"},
                  {"subjectType":"DEPARTMENT","subjectKey":"department:1","subjectLabel":"信息部"}
                ]}
                """ : """
                {"data":[
                  {"subject_type":"ACCOUNT","subject_key":"account:user-1","subject_label":"管理员甲","company_name":"示例公司","department_name":"信息部"},
                  {"subjectType":"ACCOUNT","subjectKey":"account:user-2","subjectLabel":"管理员乙","companyName":"示例公司","departmentName":"行政部"}
                ]}
                """;
            respond(exchange, response);
        });
        upstream.start();

        store = mock(AppStoreRepository.class);
        mapper = new ObjectMapper();
        tokenResolver = mock(SessionTokenResolver.class);
        identityService = mock(RequestIdentityService.class);
        ObjectProvider<SessionTokenResolver> tokenResolverProvider = mock(ObjectProvider.class);
        when(tokenResolverProvider.getIfAvailable()).thenReturn(tokenResolver);
        when(store.find(any())).thenReturn(Optional.empty());
        service = new EcpRequestOperatorService(
            "http://127.0.0.1:" + upstream.getAddress().getPort() + "/api/v1",
            "WLY5YG", store, mapper, tokenResolverProvider, identityService);
    }

    @AfterEach
    void tearDown() {
        upstream.stop(0);
    }

    @Test
    void refreshesAndPersistsOperatorsWithTheAuthorizedUserSession() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        when(identityService.current(request)).thenReturn(Optional.of(identity("super_admin", Set.of())));
        when(tokenResolver.resolveSessionToken(request)).thenReturn("Bearer session-token");

        assertThat(service.list(request))
            .extracting(EcpRequestOperatorService.RequestOperator::subject,
                EcpRequestOperatorService.RequestOperator::name)
            .containsExactly(
                org.assertj.core.groups.Tuple.tuple("user-1", "管理员甲"),
                org.assertj.core.groups.Tuple.tuple("user-2", "管理员乙"));

        assertThat(authorization).hasValue("Bearer session-token");
        assertThat(upstreamRequests).hasValue(3);
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

        assertThat(upstreamRequests).hasValue(0);
        verify(tokenResolver, never()).resolveSessionToken(any());
    }

    private void respond(HttpExchange exchange, String body) throws IOException {
        authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
        upstreamRequests.incrementAndGet();
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(200, bytes.length);
        exchange.getResponseBody().write(bytes);
        exchange.close();
    }

    private RequestIdentityService.Identity identity(String roleCode, Set<String> permissions) {
        return new RequestIdentityService.Identity(
            "测试用户", "test@example.com", "user-1", "user-1", "tenant-1",
            "信息部", "示例公司", Set.of("department-1"), roleCode, permissions);
    }
}
