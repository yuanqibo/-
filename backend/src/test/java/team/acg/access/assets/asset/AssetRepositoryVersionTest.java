package team.acg.access.assets.asset;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@SpringBootTest
@ActiveProfiles("test")
@TestPropertySource(properties = "spring.datasource.url=jdbc:h2:mem:asset-version-test;MODE=MySQL;DB_CLOSE_DELAY=-1")
class AssetRepositoryVersionTest {
    @Autowired AssetRepository repository;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper mapper;

    @BeforeEach
    void clear() {
        jdbc.update("DELETE FROM asset_record");
    }

    @Test
    void incrementsChangedRowsAndRejectsAStaleVersion() throws Exception {
        var first = mapper.readTree("{\"id\":\"A-1\",\"status\":\"空闲\",\"name\":\"初始\"}");
        repository.replaceAll(List.of(first), Map.of(), Instant.now());
        Map<String, AssetRepository.AssetRecord> versionOne = repository.findAllRecords();
        assertThat(versionOne.get("A-1").version()).isEqualTo(1);

        var second = mapper.readTree("{\"id\":\"A-1\",\"status\":\"空闲\",\"name\":\"更新\"}");
        repository.replaceAll(List.of(second), versionOne, Instant.now());
        assertThat(repository.findAllRecords().get("A-1").version()).isEqualTo(2);

        var stale = mapper.readTree("{\"id\":\"A-1\",\"status\":\"空闲\",\"name\":\"过期覆盖\"}");
        assertThatThrownBy(() -> repository.replaceAll(List.of(stale), versionOne, Instant.now()))
            .isInstanceOf(AssetVersionConflictException.class);
        assertThat(repository.findAllRecords().get("A-1").document().path("name").asText()).isEqualTo("更新");
    }

    @Test
    void leavesUnchangedRowsAtTheirCurrentVersion() throws Exception {
        var asset = mapper.readTree("{\"id\":\"A-1\",\"status\":\"空闲\"}");
        repository.replaceAll(List.of(asset), Map.of(), Instant.now());
        Map<String, AssetRepository.AssetRecord> current = repository.findAllRecords();

        repository.replaceAll(List.of(asset.deepCopy()), current, Instant.now());

        assertThat(repository.findAllRecords().get("A-1").version()).isEqualTo(1);
    }

    @Test
    void sourceSnapshotRemovesLocalAndStaleSourceRows() throws Exception {
        var local = mapper.readTree("{\"id\":\"LOCAL-1\",\"status\":\"空闲\"}");
        var currentLegacy = mapper.readTree("{\"id\":\"legacy-asset-1\",\"sourceSystem\":\"bear-rental-ams\",\"status\":\"空闲\"}");
        var staleLegacy = mapper.readTree("{\"id\":\"legacy-asset-2\",\"sourceSystem\":\"bear-rental-ams\",\"status\":\"已处置\"}");
        repository.replaceAll(List.of(local, currentLegacy, staleLegacy), Map.of(), Instant.now());

        assertThat(repository.reconcileSourceSnapshot("bear-rental-ams", Set.of("legacy-asset-1"))).isEqualTo(2);
        assertThat(repository.findAllRecords()).containsKey("legacy-asset-1").doesNotContainKeys("LOCAL-1", "legacy-asset-2");
    }

    @Test
    void backfillsStandardAssetCodesFromEarlierLegacySyncRecords() throws Exception {
        var legacy = mapper.readTree("{\"id\":\"legacy-asset-1\",\"sourceSystem\":\"bear-rental-ams\",\"status\":\"领用\",\"legacyAssetCode\":\"PC-001\"}");
        var local = mapper.readTree("{\"id\":\"LOCAL-1\",\"status\":\"空闲\",\"legacyAssetCode\":\"LOCAL-CODE\"}");
        repository.replaceAll(List.of(legacy, local), Map.of(), Instant.now());

        assertThat(repository.backfillLegacyAssetCodes("bear-rental-ams", Instant.now())).isEqualTo(1);
        assertThat(repository.find("legacy-asset-1").path("assetCode").asText()).isEqualTo("PC-001");
        assertThat(repository.find("LOCAL-1").path("assetCode").asText()).isEmpty();
        assertThat(repository.backfillLegacyAssetCodes("bear-rental-ams", Instant.now())).isZero();
    }
}
