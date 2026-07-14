package team.acg.access.assets.store;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.idanchuang.ecp.sdk.spring.annotation.RequireAnyPermission;
import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.Test;
import team.acg.access.assets.auth.RequestIdentityService;

import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.Arrays;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class StoreControllerLabelPermissionTest {
    private static final String CUSTOM_KEY = "assetLabelCustomTemplatesV1";
    private static final String PRINT_KEY = "assetLabelPrintSettingsV2";
    private final ObjectMapper mapper = new ObjectMapper();
    private final AppStoreRepository repository = mock(AppStoreRepository.class);
    private final PortalDocumentValidator validator = mock(PortalDocumentValidator.class);
    private final RequestIdentityService identity = mock(RequestIdentityService.class);
    private final HttpServletRequest request = mock(HttpServletRequest.class);
    private final StoreController controller = new StoreController(repository, mapper, validator, identity, 1_000_000);

    @Test
    void exposesAllLabelWritePermissionsAtTheEcpAnnotationBoundary() throws Exception {
        RequireAnyPermission annotation = StoreController.class
            .getMethod("save", StoreController.StoreWriteRequest.class, HttpServletRequest.class)
            .getAnnotation(RequireAnyPermission.class);

        assertThat(annotation).isNotNull();
        assertThat(Arrays.stream(annotation.value()).map(spec -> spec.value()).toList()).containsExactlyInAnyOrder(
            "asset:label_template_settings:create",
            "asset:label_template_settings:update",
            "asset:label_template_settings:delete",
            "asset:label_template_settings:save",
            "asset:label_template_settings:reset");
    }

    @Test
    void requiresTheExactPermissionForEveryDeclaredOperation() throws Exception {
        JsonNode empty = mapper.readTree("[]");
        JsonNode created = mapper.readTree("[{\"key\":\"custom_a\",\"name\":\"A\"}]");
        JsonNode updated = mapper.readTree("[{\"key\":\"custom_a\",\"name\":\"B\"}]");
        when(repository.findForUpdate(CUSTOM_KEY))
            .thenReturn(stored(empty))
            .thenReturn(stored(created))
            .thenReturn(stored(updated));
        when(repository.findForUpdate(PRINT_KEY)).thenReturn(Optional.empty());
        when(repository.saveAll(any())).thenReturn(Instant.EPOCH);

        controller.save(write("create", CUSTOM_KEY, created), request);
        controller.save(write("update", CUSTOM_KEY, updated), request);
        controller.save(write("delete", CUSTOM_KEY, empty), request);
        controller.save(write("save", PRINT_KEY, mapper.readTree("{\"columns\":2}")), request);
        controller.save(write("reset", PRINT_KEY, mapper.readTree("{\"columns\":1}")), request);

        verify(identity).requirePermission(request, "asset:label_template_settings:create");
        verify(identity).requirePermission(request, "asset:label_template_settings:update");
        verify(identity).requirePermission(request, "asset:label_template_settings:delete");
        verify(identity).requirePermission(request, "asset:label_template_settings:save");
        verify(identity).requirePermission(request, "asset:label_template_settings:reset");
    }

    @Test
    void rejectsAnOperationThatDoesNotMatchTheCustomTemplateDifference() throws Exception {
        JsonNode before = mapper.readTree("[{\"key\":\"custom_a\",\"name\":\"A\"}]");
        JsonNode added = mapper.readTree("[{\"key\":\"custom_a\",\"name\":\"A\"},{\"key\":\"custom_b\",\"name\":\"B\"}]");
        when(repository.findForUpdate(CUSTOM_KEY)).thenReturn(stored(before));

        assertThatThrownBy(() -> controller.save(write("update", CUSTOM_KEY, added), request))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("does not match");

        verify(repository, never()).saveAll(any());
    }

    @Test
    void rejectsMultipleTemplateChangesAndDocumentOperationMixing() throws Exception {
        JsonNode before = mapper.readTree("[{\"key\":\"custom_a\",\"name\":\"A\"},{\"key\":\"custom_b\",\"name\":\"B\"}]");
        JsonNode changedTwice = mapper.readTree("[{\"key\":\"custom_a\",\"name\":\"A2\"},{\"key\":\"custom_b\",\"name\":\"B2\"}]");
        when(repository.findForUpdate(CUSTOM_KEY)).thenReturn(stored(before));

        assertThatThrownBy(() -> controller.save(write("update", CUSTOM_KEY, changedTwice), request))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("does not match");
        assertThatThrownBy(() -> controller.save(write("save", CUSTOM_KEY, before), request))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("not allowed");
        assertThatThrownBy(() -> controller.save(write("create", PRINT_KEY, mapper.createObjectNode()), request))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("not allowed");
    }

    @Test
    void rejectsBatchWritesEvenWhenTheyOnlyContainLabelDocuments() {
        var batch = new StoreController.StoreWriteRequest("save", null, null, Map.of(
            PRINT_KEY, mapper.createObjectNode(),
            CUSTOM_KEY, mapper.createArrayNode()));

        assertThatThrownBy(() -> controller.save(batch, request))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("exactly one key");
    }

    private StoreController.StoreWriteRequest write(String operation, String key, JsonNode value) {
        return new StoreController.StoreWriteRequest(operation, key, value, null);
    }

    private Optional<AppStoreRepository.StoreValue> stored(JsonNode value) {
        return Optional.of(new AppStoreRepository.StoreValue(value, Instant.EPOCH));
    }
}
