package team.acg.access.assets.ecp;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.idanchuang.ecp.api.common.model.directory.EcpUserProfile;
import com.idanchuang.ecp.sdk.client.model.EcpPage;
import org.junit.jupiter.api.Test;

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
                  "path": "杭州艾柯塞斯品牌管理有限公司/IT与信息安全部",
                  "fullPath": "杭州艾柯塞斯品牌管理有限公司/IT与信息安全部/袁其博"
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
}
