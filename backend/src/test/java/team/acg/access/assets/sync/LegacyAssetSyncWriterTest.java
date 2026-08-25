package team.acg.access.assets.sync;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import team.acg.access.assets.asset.AssetRepository;

import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class LegacyAssetSyncWriterTest {
    private final ObjectMapper mapper = new ObjectMapper();
    private final AssetRepository assets = mock(AssetRepository.class);
    private final LegacyAssetSyncWriter writer = new LegacyAssetSyncWriter(assets, mapper);
    private final Instant syncedAt = Instant.parse("2026-08-24T02:00:00Z");

    @Test
    void mapsLegacyDetailToStableTargetIdAndCurrentStatus() {
        when(assets.find("legacy-asset-7")).thenReturn(null);
        JsonNode source = mapper.createObjectNode()
            .put("assetId", 7).put("assetCode", "PC-007").put("assetName", "研发电脑")
            .put("assetsCategoryName", "电脑").put("assetStatus", 9).put("useStatus", 1)
            .put("brand", "Lenovo").put("assetSequenceNo", "SN-007")
            .put("employeeName", "李雷").put("departmentName", "研发部")
            .put("placeName", "总部").put("amount", 5000);

        writer.upsert(source, syncedAt);

        var captured = org.mockito.ArgumentCaptor.forClass(JsonNode.class);
        verify(assets).upsertFromSync(captured.capture(), eq(syncedAt));
        JsonNode mapped = captured.getValue();
        assertThat(mapped.path("id").asText()).isEqualTo("legacy-asset-7");
        assertThat(mapped.path("legacyAssetId").asLong()).isEqualTo(7);
        assertThat(mapped.path("legacyAssetCode").asText()).isEqualTo("PC-007");
        assertThat(mapped.path("sourceSystem").asText()).isEqualTo("bear-rental-ams");
        assertThat(mapped.path("status").asText()).isEqualTo("借用");
        assertThat(mapped.path("owner").asText()).isEqualTo("李雷");
        verify(assets).appendAudit("legacy-asset-7", "LEGACY_SYNC", "", "借用", syncedAt);
    }

    @Test
    void mapsTransferAndFaultStatusesWithoutTreatingThemAsIdle() {
        when(assets.find("legacy-asset-8")).thenReturn(null);
        writer.upsert(mapper.createObjectNode().put("assetId", 8).put("assetStatus", 13), syncedAt);
        var transfer = org.mockito.ArgumentCaptor.forClass(JsonNode.class);

        when(assets.find("legacy-asset-9")).thenReturn(null);
        writer.upsert(mapper.createObjectNode().put("assetId", 9).put("assetStatus", 1).put("useStatus", 3), syncedAt);
        verify(assets, times(2)).upsertFromSync(transfer.capture(), eq(syncedAt));
        List<JsonNode> mapped = transfer.getAllValues();
        assertThat(mapped.get(0).path("status").asText()).isEqualTo("调拨中");
        assertThat(mapped.get(1).path("status").asText()).isEqualTo("维修中");
    }

    @Test
    void preservesTargetLifecycleWhenApplyingAChangedLegacySnapshot() {
        JsonNode current = mapper.createObjectNode().put("id", "legacy-asset-7").put("status", "领用")
            .set("lifecycle", mapper.createArrayNode().add("existing-operation"));
        when(assets.find("legacy-asset-7")).thenReturn(current);
        JsonNode source = mapper.createObjectNode().put("assetId", 7).put("assetCode", "PC-007")
            .put("assetName", "研发电脑").put("assetsCategoryName", "电脑").put("assetStatus", 5)
            .put("employeeName", "韩梅梅");

        writer.upsert(source, syncedAt);

        var captured = org.mockito.ArgumentCaptor.forClass(JsonNode.class);
        verify(assets).upsertFromSync(captured.capture(), eq(syncedAt));
        assertThat(captured.getValue().path("owner").asText()).isEqualTo("韩梅梅");
        assertThat(captured.getValue().path("lifecycle").toString()).isEqualTo("[\"existing-operation\"]");
        verify(assets, never()).appendAudit(any(), any(), any(), any(), any());
    }

    @Test
    void softDeletesMissingLegacyAssetWithoutRemovingItsTargetRecord() {
        JsonNode current = mapper.createObjectNode().put("id", "legacy-asset-7")
            .put("name", "研发电脑").put("category", "电脑").put("status", "领用")
            .set("lifecycle", mapper.createArrayNode().add("existing-operation"));
        when(assets.find("legacy-asset-7")).thenReturn(current);

        writer.markDeleted(7, "PC-007", syncedAt);

        var captured = org.mockito.ArgumentCaptor.forClass(JsonNode.class);
        verify(assets).upsertFromSync(captured.capture(), eq(syncedAt));
        JsonNode deleted = captured.getValue();
        assertThat(deleted.path("status").asText()).isEqualTo("已处置");
        assertThat(deleted.path("sourceDeleted").asBoolean()).isTrue();
        assertThat(deleted.path("legacyAssetCode").asText()).isEqualTo("PC-007");
        assertThat(deleted.path("lifecycle").toString()).isEqualTo("[\"existing-operation\"]");
    }
}
