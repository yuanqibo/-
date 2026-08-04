package team.acg.access.assets.asset;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.idanchuang.ecp.api.common.model.directory.EcpUserProfile;
import com.idanchuang.ecp.sdk.client.exception.EcpPermissionDeniedException;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import team.acg.access.assets.ecp.EcpDirectoryUserService;
import team.acg.access.assets.ecp.EcpSecurityPolicy;
import team.acg.access.assets.ecp.EcpSelectableDirectoryService;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.eq;
import static org.mockito.Mockito.anyCollection;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class AssetPartyResolverTest {
    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    @SuppressWarnings("unchecked")
    void overwritesForgedPartyFieldsFromTheDirectory() {
        ObjectProvider<EcpDirectoryUserService> provider = mock(ObjectProvider.class);
        ObjectProvider<EcpSelectableDirectoryService> selectableProvider = mock(ObjectProvider.class);
        EcpDirectoryUserService directory = mock(EcpDirectoryUserService.class);
        EcpSecurityPolicy policy = mock(EcpSecurityPolicy.class);
        when(policy.enabled()).thenReturn(true);
        when(provider.getIfAvailable()).thenReturn(directory);
        when(directory.requireBySubject("user-1")).thenReturn(new EcpDirectoryUserService.DirectoryParty(
            "user-1", "李雷", "department-1", "销售部", "company-1", "示例公司"));
        AssetPartyResolver resolver = new AssetPartyResolver(provider, selectableProvider, policy);
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
        ObjectProvider<EcpSelectableDirectoryService> selectableProvider = mock(ObjectProvider.class);
        EcpSecurityPolicy policy = mock(EcpSecurityPolicy.class);
        when(policy.enabled()).thenReturn(true);
        AssetPartyResolver resolver = new AssetPartyResolver(provider, selectableProvider, policy);
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
        ObjectProvider<EcpSelectableDirectoryService> selectableProvider = mock(ObjectProvider.class);
        EcpDirectoryUserService directory = mock(EcpDirectoryUserService.class);
        EcpSecurityPolicy policy = mock(EcpSecurityPolicy.class);
        when(policy.enabled()).thenReturn(true);
        when(provider.getIfAvailable()).thenReturn(directory);
        when(directory.requireBySubject("user-1")).thenReturn(new EcpDirectoryUserService.DirectoryParty(
            "user-1", "李雷", "department-1", "销售部", "company-1", "示例公司"));
        when(directory.requireBySubject("user-2")).thenReturn(new EcpDirectoryUserService.DirectoryParty(
            "user-2", "韩梅梅", "department-2", "研发部", "company-1", "示例公司"));
        AssetPartyResolver resolver = new AssetPartyResolver(provider, selectableProvider, policy);
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

    @Test
    @SuppressWarnings("unchecked")
    void resolvesReplacementOwnersInOneDirectoryBatch() {
        ObjectProvider<EcpDirectoryUserService> provider = mock(ObjectProvider.class);
        ObjectProvider<EcpSelectableDirectoryService> selectableProvider = mock(ObjectProvider.class);
        EcpDirectoryUserService directory = mock(EcpDirectoryUserService.class);
        EcpSecurityPolicy policy = mock(EcpSecurityPolicy.class);
        when(policy.enabled()).thenReturn(true);
        when(provider.getIfAvailable()).thenReturn(directory);
        when(directory.requireByNames(java.util.Set.of("李雷"))).thenReturn(Map.of("李雷",
            new EcpDirectoryUserService.DirectoryParty(
                "user-1", "李雷", "department-1", "销售部", "company-1", "示例公司")));
        AssetPartyResolver resolver = new AssetPartyResolver(provider, selectableProvider, policy);
        ObjectNode assigned = mapper.createObjectNode().put("id", "A-1").put("owner", "李雷");
        ObjectNode unassigned = mapper.createObjectNode().put("id", "A-2").put("owner", "");

        List<com.fasterxml.jackson.databind.JsonNode> normalized = resolver.normalizeReplacementDrafts(
            List.of(assigned, unassigned), "Bearer session-token");

        assertThat(normalized.get(0).path("ownerSubject").asText()).isEqualTo("user-1");
        assertThat(normalized.get(0).path("department").asText()).isEqualTo("销售部");
        assertThat(normalized.get(1).path("owner").asText()).isEqualTo("未分配");
    }

    @Test
    @SuppressWarnings("unchecked")
    void resolvesDuplicateReplacementNamesByUniqueEmail() {
        ObjectProvider<EcpDirectoryUserService> provider = mock(ObjectProvider.class);
        ObjectProvider<EcpSelectableDirectoryService> selectableProvider = mock(ObjectProvider.class);
        EcpDirectoryUserService directory = mock(EcpDirectoryUserService.class);
        EcpSecurityPolicy policy = mock(EcpSecurityPolicy.class);
        when(policy.enabled()).thenReturn(true);
        when(provider.getIfAvailable()).thenReturn(directory);
        when(directory.requireByEmails(java.util.Set.of(
            "lihui@accesscorporate.com.cn", "lihui4@accesscorporate.com.cn"))).thenReturn(Map.of(
                "lihui@accesscorporate.com.cn", new EcpDirectoryUserService.DirectoryParty(
                    "user-1", "李慧", "department-1", "综合设计组", "company-1", "示例公司"),
                "lihui4@accesscorporate.com.cn", new EcpDirectoryUserService.DirectoryParty(
                    "user-4", "李慧", "department-4", "Eimele抖音运营部", "company-1", "示例公司")));
        AssetPartyResolver resolver = new AssetPartyResolver(provider, selectableProvider, policy);

        List<com.fasterxml.jackson.databind.JsonNode> normalized = resolver.normalizeReplacementDrafts(List.of(
            mapper.createObjectNode().put("id", "A-1").put("owner", "李慧")
                .put("email", "LIHUI@accesscorporate.com.cn"),
            mapper.createObjectNode().put("id", "A-2").put("owner", "李慧")
                .put("email", "lihui4@accesscorporate.com.cn")), "Bearer session-token");

        assertThat(normalized.get(0).path("ownerSubject").asText()).isEqualTo("user-1");
        assertThat(normalized.get(0).path("department").asText()).isEqualTo("综合设计组");
        assertThat(normalized.get(1).path("ownerSubject").asText()).isEqualTo("user-4");
        assertThat(normalized.get(1).path("department").asText()).isEqualTo("Eimele抖音运营部");
        verify(directory, never()).requireByNames(anyCollection());
    }

    @Test
    @SuppressWarnings("unchecked")
    void fallsBackToTheSessionSelectableDirectoryForReplacementOwners() {
        ObjectProvider<EcpDirectoryUserService> provider = mock(ObjectProvider.class);
        ObjectProvider<EcpSelectableDirectoryService> selectableProvider = mock(ObjectProvider.class);
        EcpDirectoryUserService directory = mock(EcpDirectoryUserService.class);
        EcpSelectableDirectoryService selectable = mock(EcpSelectableDirectoryService.class);
        EcpSecurityPolicy policy = mock(EcpSecurityPolicy.class);
        EcpUserProfile profile = mock(EcpUserProfile.class);
        List<EcpUserProfile> users = List.of(profile);
        when(profile.name()).thenReturn("李雷");
        when(policy.enabled()).thenReturn(true);
        when(provider.getIfAvailable()).thenReturn(directory);
        when(selectableProvider.getIfAvailable()).thenReturn(selectable);
        when(directory.requireByNames(java.util.Set.of("李雷")))
            .thenThrow(mock(EcpPermissionDeniedException.class));
        when(selectable.snapshot("Bearer session-token")).thenReturn(
            new EcpSelectableDirectoryService.DirectorySnapshot(List.of(), List.of(), users));
        when(directory.namesWithoutUniqueMatch(java.util.Set.of("李雷"), users))
            .thenReturn(java.util.Set.of("李雷"), java.util.Set.of());
        when(selectable.exactNameMatches(java.util.Set.of("李雷"), "Bearer session-token"))
            .thenReturn(users);
        when(directory.requireByNames(eq(java.util.Set.of("李雷")), anyCollection())).thenReturn(Map.of("李雷",
            new EcpDirectoryUserService.DirectoryParty(
                "user-1", "李雷", "department-1", "销售部", "company-1", "示例公司")));
        AssetPartyResolver resolver = new AssetPartyResolver(provider, selectableProvider, policy);

        List<com.fasterxml.jackson.databind.JsonNode> normalized = resolver.normalizeReplacementDrafts(
            List.of(mapper.createObjectNode().put("id", "A-1").put("owner", "李雷")),
            "Bearer session-token");

        assertThat(normalized.get(0).path("ownerSubject").asText()).isEqualTo("user-1");
        assertThat(normalized.get(0).path("company").asText()).isEqualTo("示例公司");
        verify(selectable).exactNameMatches(java.util.Set.of("李雷"), "Bearer session-token");
    }

    @Test
    @SuppressWarnings("unchecked")
    void quarantinesUnresolvableReplacementOwnersWithoutImpersonatingAnEcpAccount() {
        ObjectProvider<EcpDirectoryUserService> provider = mock(ObjectProvider.class);
        ObjectProvider<EcpSelectableDirectoryService> selectableProvider = mock(ObjectProvider.class);
        EcpDirectoryUserService directory = mock(EcpDirectoryUserService.class);
        EcpSelectableDirectoryService selectable = mock(EcpSelectableDirectoryService.class);
        EcpSecurityPolicy policy = mock(EcpSecurityPolicy.class);
        when(policy.enabled()).thenReturn(true);
        when(provider.getIfAvailable()).thenReturn(directory);
        when(selectableProvider.getIfAvailable()).thenReturn(selectable);
        when(directory.requireByNames(java.util.Set.of("历史员工")))
            .thenThrow(mock(EcpPermissionDeniedException.class));
        when(selectable.snapshot("Bearer session-token")).thenReturn(
            new EcpSelectableDirectoryService.DirectorySnapshot(List.of(), List.of(), List.of()));
        when(directory.namesWithoutUniqueMatch(java.util.Set.of("历史员工"), List.of()))
            .thenReturn(java.util.Set.of("历史员工"));
        when(selectable.exactNameMatches(java.util.Set.of("历史员工"), "Bearer session-token"))
            .thenReturn(List.of());

        AssetPartyResolver resolver = new AssetPartyResolver(provider, selectableProvider, policy);
        List<com.fasterxml.jackson.databind.JsonNode> normalized = resolver.normalizeReplacementDrafts(
            List.of(mapper.createObjectNode().put("id", "A-1").put("owner", "历史员工")),
            "Bearer session-token");

        assertThat(normalized.get(0).path("owner").asText()).isEqualTo("历史员工");
        assertThat(normalized.get(0).path("ownerSubject").asText())
            .startsWith(AssetPartyResolver.LEGACY_OWNER_SUBJECT_PREFIX);
        verify(directory, never()).requireByNames(anyCollection(), anyCollection());
    }
}
