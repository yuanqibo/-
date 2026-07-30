package team.acg.access.assets.ecp;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import com.idanchuang.ecp.api.common.model.directory.EcpDepartmentProfile;
import com.idanchuang.ecp.api.common.model.directory.EcpUserProfile;
import com.idanchuang.ecp.sdk.client.model.EcpPage;
import org.junit.jupiter.api.Test;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;

class EcpSelectableDirectoryServiceTest {
    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void mapsSelectableAccountsAndIgnoresOrganizationNodes() throws Exception {
        EcpPage<EcpUserProfile> page = EcpSelectableDirectoryService.parsePage(mapper.readTree("""
            {
              "nodes": [
                {
                  "nodeType": "ACCOUNT",
                  "subject": "account:user-1",
                  "accountUnionId": "user-1",
                  "accountSetUnionId": "account-set-1",
                  "orgNodeUnionId": "department-1",
                  "name": "袁其博",
                  "employeeNo": "A001",
                  "email": "yuan@example.com",
                  "path": "飞书/杭州艾柯塞斯品牌管理有限公司/IT与信息安全部",
                  "fullPath": "飞书/杭州艾柯塞斯品牌管理有限公司/IT与信息安全部/袁其博"
                },
                {
                  "nodeType": "ORG",
                  "subject": "org:department-1",
                  "name": "IT与信息安全部"
                }
              ],
              "total": 2
            }
            """), 1, 100);

        assertThat(page.items()).hasSize(1);
        EcpUserProfile profile = page.items().get(0);
        assertThat(profile.unionId()).isEqualTo("user-1");
        assertThat(profile.name()).isEqualTo("袁其博");
        assertThat(profile.employeeNo()).isEqualTo("A001");
        assertThat(profile.company().name()).isEqualTo("杭州艾柯塞斯品牌管理有限公司");
        assertThat(profile.departments()).extracting(EcpUserProfile.DepartmentSummary::name)
            .containsExactly("IT与信息安全部");
    }

    @Test
    void acceptsAssignmentStyleFieldsReturnedByEcp() throws Exception {
        EcpPage<EcpUserProfile> page = EcpSelectableDirectoryService.parsePage(mapper.readTree("""
            {
              "nodes": [{
                "subjectType": "ACCOUNT",
                "subjectKey": "account:user-2",
                "subjectAccountId": "user-2",
                "subjectLabel": "任吉财",
                "companyName": "示例公司",
                "departmentName": "行政管理"
              }]
            }
            """), 1, 20);

        EcpUserProfile profile = page.items().get(0);
        assertThat(profile.unionId()).isEqualTo("user-2");
        assertThat(profile.name()).isEqualTo("任吉财");
        assertThat(profile.company().name()).isEqualTo("示例公司");
        assertThat(profile.departments().get(0).name()).isEqualTo("行政管理");
    }

    @Test
    void mapsSelectableDepartmentTreeToCompaniesAndDepartments() throws Exception {
        EcpSelectableDirectoryService.ParsedOrganization organization =
            EcpSelectableDirectoryService.parseOrganization(mapper.readTree("""
                {
                  "nodes": [{
                    "accountSetUnionId": "account-set-1",
                    "orgNodeUnionId": "company-1",
                    "name": "杭州艾柯塞斯品牌管理有限公司",
                    "fullPath": "飞书/杭州艾柯塞斯品牌管理有限公司",
                    "children": [{
                      "accountSetUnionId": "account-set-1",
                      "orgNodeUnionId": "department-1",
                      "name": "IT与信息安全部",
                      "fullPath": "飞书/杭州艾柯塞斯品牌管理有限公司/IT与信息安全部"
                    }]
                  }]
                }
                """));

        assertThat(organization.companies()).singleElement().satisfies(company -> {
            assertThat(company.unionId()).isEqualTo("company-1");
            assertThat(company.name()).isEqualTo("杭州艾柯塞斯品牌管理有限公司");
            assertThat(company.accountSetUnionId()).isEqualTo("account-set-1");
        });
        assertThat(organization.departments()).extracting(EcpDepartmentProfile::unionId,
            EcpDepartmentProfile::parentUnionId, EcpDepartmentProfile::companyUnionId)
            .containsExactly(org.assertj.core.groups.Tuple.tuple("department-1", "company-1", "company-1"));
    }

    @Test
    void loadsBlankDirectoryFromSelectableOrganizationWithoutSendingAnEmptyQuery() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress(0), 0);
        AtomicReference<String> accountQuery = new AtomicReference<>();
        server.createContext("/applications/WLY5YG/selectable-departments", exchange -> respond(exchange, """
            {"nodes":[{
              "accountSetUnionId":"account-set-1",
              "orgNodeUnionId":"company-1",
              "name":"示例公司",
              "children":[{
                "accountSetUnionId":"account-set-1",
                "orgNodeUnionId":"department-1",
                "name":"行政管理"
              }]
            }]}
            """));
        server.createContext("/applications/WLY5YG/selectable-accounts", exchange -> {
            accountQuery.set(exchange.getRequestURI().getRawQuery());
            respond(exchange, """
                {"nodes":[{
                  "nodeType":"ACCOUNT",
                  "subject":"account:user-1",
                  "accountUnionId":"user-1",
                  "accountSetUnionId":"account-set-1",
                  "orgNodeUnionId":"department-1",
                  "name":"任吉财"
                }],"total":1}
                """);
        });
        server.start();
        try {
            EcpSelectableDirectoryService service = new EcpSelectableDirectoryService(
                mapper, "http://127.0.0.1:" + server.getAddress().getPort(), "WLY5YG");

            EcpPage<EcpUserProfile> page = service.page("", 1, 50, "Bearer session-token");

            assertThat(page.items()).extracting(EcpUserProfile::name).containsExactly("任吉财");
            assertThat(page.items().get(0).company().name()).isEqualTo("示例公司");
            assertThat(page.items().get(0).departments()).extracting(EcpUserProfile.DepartmentSummary::name)
                .containsExactly("行政管理");
            assertThat(accountQuery.get()).contains("recursive=true").doesNotContain("q=");
        } finally {
            server.stop(0);
        }
    }

    private static void respond(com.sun.net.httpserver.HttpExchange exchange, String body) throws java.io.IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json;charset=UTF-8");
        exchange.sendResponseHeaders(200, bytes.length);
        exchange.getResponseBody().write(bytes);
        exchange.close();
    }
}
