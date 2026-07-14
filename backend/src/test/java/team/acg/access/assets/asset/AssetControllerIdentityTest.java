package team.acg.access.assets.asset;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.Test;
import team.acg.access.assets.auth.RequestIdentityService;

import java.util.List;
import java.util.Optional;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.never;

class AssetControllerIdentityTest {
    @Test
    void injectsTheDirectorySubjectForHandoverSignature() {
        AssetService service = mock(AssetService.class);
        RequestIdentityService identities = mock(RequestIdentityService.class);
        AssetPartyResolver parties = mock(AssetPartyResolver.class);
        HttpServletRequest request = mock(HttpServletRequest.class);
        var identity = new RequestIdentityService.Identity(
            "李雷", "lilei", "account-union-1", "user-union-1", "tenant-1", "销售部",
            Set.of("department-1"), "employee",
            Set.of("asset:item:view", "asset:receive_return:view", "asset:receive_return:sign"));
        when(identities.current(request)).thenReturn(Optional.of(identity));
        when(service.execute(eq("handover-sign"), eq(List.of("A-1")), any())).thenAnswer(invocation -> {
            assertThat(invocation.<com.fasterxml.jackson.databind.JsonNode>getArgument(2)
                .path("operatorSubject").asText()).isEqualTo("user-union-1");
            return List.of();
        });
        AssetController controller = new AssetController(service, identities, parties);
        var fields = new ObjectMapper().createObjectNode().put("operatorSubject", "forged-user");

        controller.command("handover-sign",
            new AssetController.AssetCommandRequest(List.of("A-1"), fields), request);

        verify(identities).requirePermission(request, "asset:receive_return:sign");
    }

    @Test
    void importCommandsAlwaysDemandTheirDedicatedPermissions() {
        AssetService service = mock(AssetService.class);
        RequestIdentityService identities = mock(RequestIdentityService.class);
        AssetPartyResolver parties = mock(AssetPartyResolver.class);
        HttpServletRequest request = mock(HttpServletRequest.class);
        when(identities.current(request)).thenReturn(Optional.empty());
        when(service.execute(any(), any(), any())).thenReturn(List.of());
        AssetController controller = new AssetController(service, identities, parties);
        var fields = new ObjectMapper().createObjectNode().putObject("operations");

        controller.command("update-import",
            new AssetController.AssetCommandRequest(List.of("A-1"), fields), request);
        controller.command("receive-import",
            new AssetController.AssetCommandRequest(List.of("A-1"), fields), request);

        verify(identities).requirePermission(request, "asset:item:updateImport");
        verify(identities).requirePermission(request, "asset:item:receiveImport");
        verify(identities, never()).requirePermission(request, "asset:item:update");
        verify(identities, never()).requirePermission(request, "asset:receive_return:receive");
    }
}
