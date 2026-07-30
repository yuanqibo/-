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
    void doesNotRequireSignatureWhenTheSettingIsMissing() {
        when(repository.find("assetPortalSelfServiceSettingsV9")).thenReturn(Optional.empty());

        assertThat(policy.requiresEmployeeHandoverSignature()).isFalse();
    }

    @Test
    void readsTheServerManagedHandoverSignatureSetting() throws Exception {
        var value = mapper.readTree("{\"signSettings\":{\"assetHandover\":{\"employeeSign\":false}}}");
        when(repository.find("assetPortalSelfServiceSettingsV9"))
            .thenReturn(Optional.of(new AppStoreRepository.StoreValue(value, Instant.now())));

        assertThat(policy.requiresEmployeeHandoverSignature()).isFalse();
    }

    @Test
    void administratorFlowRequiresSignatureOnlyWhenSigningOrNoticeConfirmationIsEnabled() throws Exception {
        var value = mapper.readTree("""
            {"signSettings":{
              "assetReceive":{"employeeSign":true,"noticeEnabled":false},
              "assetBorrow":{"employeeSign":false,"noticeEnabled":true}
            }}
            """);
        when(repository.find("assetPortalSelfServiceSettingsV9"))
            .thenReturn(Optional.of(new AppStoreRepository.StoreValue(value, Instant.now())));

        assertThat(policy.requiresEmployeeSignature("RECEIVE")).isTrue();
        assertThat(policy.requiresEmployeeSignature("BORROW")).isTrue();
        assertThat(policy.requiresEmployeeSignature("HANDOVER")).isFalse();
    }

    @Test
    void selfServiceNoticeDoesNotCreateASecondReceiptSignature() throws Exception {
        var value = mapper.readTree("""
            {"signSettings":{"selfReceiveAsset":{
              "noticeEnabled":true,"timings":{"start":true,"receive":false}
            }}}
            """);
        when(repository.find("assetPortalSelfServiceSettingsV9"))
            .thenReturn(Optional.of(new AppStoreRepository.StoreValue(value, Instant.now())));

        assertThat(policy.requiresEmployeeSignature("RECEIVE", true)).isFalse();
    }

    @Test
    void selfServiceReceiptSignatureUsesTheReceiveTiming() throws Exception {
        var value = mapper.readTree("""
            {"signSettings":{"selfBorrowAsset":{
              "noticeEnabled":false,"timings":{"start":false,"receive":true}
            }}}
            """);
        when(repository.find("assetPortalSelfServiceSettingsV9"))
            .thenReturn(Optional.of(new AppStoreRepository.StoreValue(value, Instant.now())));

        assertThat(policy.requiresEmployeeSignature("BORROW", true)).isTrue();
    }
}
