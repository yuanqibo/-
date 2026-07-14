package team.acg.access.assets.asset;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import team.acg.access.assets.store.AppStoreRepository;

import java.time.Instant;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class AssetWorkflowPolicyTest {
    private final AppStoreRepository repository = mock(AppStoreRepository.class);
    private final ObjectMapper mapper = new ObjectMapper();
    private final AssetWorkflowPolicy policy = new AssetWorkflowPolicy(repository);

    @Test
    void requiresSignatureWhenTheSettingIsMissing() {
        when(repository.find("assetPortalSelfServiceSettingsV9")).thenReturn(Optional.empty());

        assertThat(policy.requiresEmployeeHandoverSignature()).isTrue();
    }

    @Test
    void readsTheServerManagedHandoverSignatureSetting() throws Exception {
        var value = mapper.readTree("{\"signSettings\":{\"assetHandover\":{\"employeeSign\":false}}}");
        when(repository.find("assetPortalSelfServiceSettingsV9"))
            .thenReturn(Optional.of(new AppStoreRepository.StoreValue(value, Instant.now())));

        assertThat(policy.requiresEmployeeHandoverSignature()).isFalse();
    }
}
