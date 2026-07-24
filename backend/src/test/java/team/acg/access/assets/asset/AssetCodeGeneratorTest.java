package team.acg.access.assets.asset;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import team.acg.access.assets.store.AppStoreRepository;

import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class AssetCodeGeneratorTest {
    private final ObjectMapper mapper = new ObjectMapper();
    private final AppStoreRepository repository = mock(AppStoreRepository.class);
    private final AssetCodeGenerator generator = new AssetCodeGenerator(repository);

    @Test
    void usesEnabledCategoryCodeInGeneratedAssetCode() throws Exception {
        configureCategory(true);

        String code = generator.nextCode(mapper.readTree("{\"category\":\"IT设备\"}"), Set.of());

        assertThat(code).isEqualTo("0100001");
    }

    @Test
    void omitsDisabledCategoryCodeButKeepsAutomaticSequence() throws Exception {
        configureCategory(false);

        String code = generator.nextCode(mapper.readTree("{\"category\":\"IT设备\"}"), Set.of());

        assertThat(code).isEqualTo("ASSET-00001");
    }

    private void configureCategory(boolean enabled) throws Exception {
        JsonNode rules = mapper.readTree("{\"selectedFields\":[\"categoryCode\"],\"serialLength\":5}");
        JsonNode categories = mapper.readTree("[{\"id\":\"cat-it\",\"name\":\"IT设备\",\"code\":\"01\",\"enabled\":" + enabled + ",\"children\":[]}]");
        Map<String, JsonNode> values = Map.of(
            "assetPortalAssetCodeRuleSettingsV1", rules,
            "assetCategoryTree", categories
        );
        values.forEach((key, value) -> when(repository.find(key))
            .thenReturn(Optional.of(new AppStoreRepository.StoreValue(value, Instant.EPOCH))));
    }
}
