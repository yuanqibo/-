package team.acg.access.assets.asset;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import team.acg.access.assets.ecp.EcpDirectoryUserService;
import team.acg.access.assets.ecp.EcpSecurityPolicy;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class AssetPartyResolverTest {
    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    @SuppressWarnings("unchecked")
    void overwritesForgedPartyFieldsFromTheDirectory() {
        ObjectProvider<EcpDirectoryUserService> provider = mock(ObjectProvider.class);
        EcpDirectoryUserService directory = mock(EcpDirectoryUserService.class);
        EcpSecurityPolicy policy = mock(EcpSecurityPolicy.class);
        when(policy.enabled()).thenReturn(true);
        when(provider.getIfAvailable()).thenReturn(directory);
        when(directory.requireBySubject("user-1")).thenReturn(new EcpDirectoryUserService.DirectoryParty(
            "user-1", "李雷", "department-1", "销售部", "company-1", "示例公司"));
        AssetPartyResolver resolver = new AssetPartyResolver(provider, policy);
        ObjectNode fields = mapper.createObjectNode()
            .put("receiverSubject", "user-1").put("receiver", "伪造姓名")
            .put("department", "伪造部门").put("company", "伪造公司");

        resolver.normalizeCommand("receive", fields);

        assertThat(fields.path("receiver").asText()).isEqualTo("李雷");
        assertThat(fields.path("departmentUnionId").asText()).isEqualTo("department-1");
        assertThat(fields.path("companyUnionId").asText()).isEqualTo("company-1");
    }

    @Test
    @SuppressWarnings("unchecked")
    void controlsThePublicAreaHandoverSubjectOnTheServer() {
        ObjectProvider<EcpDirectoryUserService> provider = mock(ObjectProvider.class);
        EcpSecurityPolicy policy = mock(EcpSecurityPolicy.class);
        when(policy.enabled()).thenReturn(true);
        AssetPartyResolver resolver = new AssetPartyResolver(provider, policy);
        ObjectNode fields = mapper.createObjectNode()
            .put("handoverType", "公共交接").put("receiver", "伪造接收人").put("receiverSubject", "forged");

        resolver.normalizeCommand("handover", fields);

        assertThat(fields.path("receiver").asText()).isEqualTo("公共区域");
        assertThat(fields.path("receiverSubject").asText()).isEqualTo(AssetPartyResolver.PUBLIC_AREA_SUBJECT);
    }

    @Test
    @SuppressWarnings("unchecked")
    void normalizesEveryPartyInsideAReceiveImport() {
        ObjectProvider<EcpDirectoryUserService> provider = mock(ObjectProvider.class);
        EcpDirectoryUserService directory = mock(EcpDirectoryUserService.class);
        EcpSecurityPolicy policy = mock(EcpSecurityPolicy.class);
        when(policy.enabled()).thenReturn(true);
        when(provider.getIfAvailable()).thenReturn(directory);
        when(directory.requireBySubject("user-1")).thenReturn(new EcpDirectoryUserService.DirectoryParty(
            "user-1", "李雷", "department-1", "销售部", "company-1", "示例公司"));
        when(directory.requireBySubject("user-2")).thenReturn(new EcpDirectoryUserService.DirectoryParty(
            "user-2", "韩梅梅", "department-2", "研发部", "company-1", "示例公司"));
        AssetPartyResolver resolver = new AssetPartyResolver(provider, policy);
        ObjectNode fields = mapper.createObjectNode();
        ObjectNode operations = fields.putObject("operations");
        operations.putObject("A-1").put("receiverSubject", "user-1").put("receiver", "伪造一");
        operations.putObject("A-2").put("receiverSubject", "user-2").put("receiver", "伪造二");

        resolver.normalizeCommand("receive-import", fields);

        assertThat(operations.path("A-1").path("receiver").asText()).isEqualTo("李雷");
        assertThat(operations.path("A-1").path("departmentUnionId").asText()).isEqualTo("department-1");
        assertThat(operations.path("A-2").path("receiver").asText()).isEqualTo("韩梅梅");
        assertThat(operations.path("A-2").path("departmentUnionId").asText()).isEqualTo("department-2");
    }
}
