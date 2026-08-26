package team.acg.access.assets.sync;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import team.acg.access.assets.asset.AssetRepository;

import java.time.Duration;
import java.time.Instant;
import java.util.Optional;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class LegacyAssetSyncServiceTest {
    private final ObjectMapper mapper = new ObjectMapper();
    private LegacyAmsClient client;
    private LegacyAssetSyncProperties properties;
    private LegacyAssetSyncRepository sync;
    private LegacyAssetSyncWriter writer;
    private AssetRepository assets;
    private LegacyAssetSyncService service;

    @BeforeEach
    void setUp() {
        client = mock(LegacyAmsClient.class);
        properties = new LegacyAssetSyncProperties();
        properties.setSafetyDelay(Duration.ZERO);
        properties.setOverlap(Duration.ofMinutes(10));
        sync = mock(LegacyAssetSyncRepository.class);
        writer = mock(LegacyAssetSyncWriter.class);
        assets = mock(AssetRepository.class);
        service = new LegacyAssetSyncService(client, properties, sync, writer, mapper, assets);
    }

    @Test
    void appliesUpsertsAndSoftDeletesThenAdvancesCursor() {
        Instant cursor = Instant.parse("2026-08-24T00:00:00Z");
        when(sync.tryAcquireLock(anyString(), any())).thenReturn(true);
        when(sync.cursor()).thenReturn(Optional.of(cursor));
        when(sync.startRun(any(), any())).thenReturn("run-1");
        when(sync.eventExists(anyString())).thenReturn(false);
        ArrayNode changes = mapper.createArrayNode();
        changes.addObject().put("assetId", 7).put("assetCode", "PC-007").put("changeType", 1);
        changes.addObject().put("assetId", 8).put("assetCode", "PC-008").put("changeType", 3);
        when(client.queryAssetChanges(any(), any())).thenReturn(changes);
        JsonNode detail = mapper.createObjectNode().put("assetId", 7).put("assetCode", "PC-007");
        when(client.queryAssetDetail(7)).thenReturn(detail);

        service.run();

        verify(writer).upsert(eq(detail), any());
        verify(writer).markDeleted(eq(8L), eq("PC-008"), any());
        verify(sync, times(2)).recordEvent(anyString(), anyString(), anyInt(), anyString(), eq("run-1"));
        verify(sync).resolveDeadLetters("7:1");
        verify(sync).complete(eq("run-1"), any(), eq(2), eq(2), eq(0));
        verify(sync).releaseLock(anyString());
    }

    @Test
    void recordsFailureAndDoesNotAdvanceCursorWhenOneEventCannotBeApplied() {
        Instant cursor = Instant.parse("2026-08-24T00:00:00Z");
        when(sync.tryAcquireLock(anyString(), any())).thenReturn(true);
        when(sync.cursor()).thenReturn(Optional.of(cursor));
        when(sync.startRun(any(), any())).thenReturn("run-2");
        when(sync.eventExists(anyString())).thenReturn(false);
        ArrayNode changes = mapper.createArrayNode();
        changes.addObject().put("assetId", 7).put("assetCode", "PC-007").put("changeType", 1);
        when(client.queryAssetChanges(any(), any())).thenReturn(changes);
        when(client.queryAssetDetail(7)).thenReturn(mapper.createObjectNode().put("assetId", 7));
        doThrow(new IllegalStateException("target database unavailable"))
            .when(writer).upsert(any(), any());

        service.run();

        verify(sync).recordDeadLetter(eq("7:1"), eq("7"), eq("target database unavailable"));
        verify(sync).complete(eq("run-2"), any(), eq(1), eq(0), eq(1));
        verify(sync, never()).fail(anyString(), anyString(), anyInt(), anyInt(), anyInt());
    }

    @Test
    void skipsAConcurrentRunBeforeCallingTheLegacyApi() {
        when(sync.tryAcquireLock(anyString(), any())).thenReturn(false);

        service.run();

        verify(client, never()).queryAssetChanges(any(), any());
        verify(sync, never()).startRun(any(), any());
    }

    @Test
    void bootstrapsFromPagedAssetSnapshotsWithoutDetailRequests() {
        properties.setBootstrapEnabled(true);
        when(sync.tryAcquireLock(anyString(), any())).thenReturn(true);
        when(sync.cursor()).thenReturn(Optional.empty());
        when(sync.startRun(any(), any())).thenReturn("bootstrap-1");
        when(sync.eventExists(anyString())).thenReturn(false);
        JsonNode summary = mapper.createObjectNode().put("assetId", 7).put("assetCode", "PC-007");
        JsonNode page = mapper.createObjectNode().put("hasNextPage", false).set("list", mapper.createArrayNode().add(summary));
        when(client.pageAssets(anyInt(), anyInt(), eq(true))).thenReturn(page);

        service.run();

        verify(writer).upsert(eq(summary), any());
        verify(client, never()).queryAssetDetail(anyInt());
        verify(sync).complete(eq("bootstrap-1"), any(), eq(1), eq(1), eq(0));
        verify(assets).reconcileSourceSnapshot(eq("bear-rental-ams"), eq(java.util.Set.of("legacy-asset-7")));
    }

    @Test
    void bootstrapsEveryPageBeforeReconcilingTheSourceSnapshot() {
        properties.setBootstrapEnabled(true);
        when(sync.tryAcquireLock(anyString(), any())).thenReturn(true);
        when(sync.cursor()).thenReturn(Optional.empty());
        when(sync.startRun(any(), any())).thenReturn("bootstrap-pages");
        when(sync.eventExists(anyString())).thenReturn(false);
        JsonNode first = mapper.createObjectNode().put("assetId", 7).put("assetCode", "PC-007");
        JsonNode second = mapper.createObjectNode().put("assetId", 8).put("assetCode", "PC-008");
        JsonNode firstPage = mapper.createObjectNode().put("hasNextPage", true)
            .set("list", mapper.createArrayNode().add(first));
        JsonNode secondPage = mapper.createObjectNode().put("hasNextPage", false)
            .set("list", mapper.createArrayNode().add(second));
        when(client.pageAssets(anyInt(), anyInt(), eq(true))).thenReturn(firstPage, secondPage);

        service.run();

        verify(client).pageAssets(eq(1), anyInt(), eq(true));
        verify(client).pageAssets(eq(2), anyInt(), eq(true));
        verify(writer).upsert(eq(first), any());
        verify(writer).upsert(eq(second), any());
        verify(sync).complete(eq("bootstrap-pages"), any(), eq(2), eq(2), eq(0));
        verify(assets).reconcileSourceSnapshot(eq("bear-rental-ams"),
            eq(java.util.Set.of("legacy-asset-7", "legacy-asset-8")));
    }

    @Test
    void doesNotReconcileAnIncompleteSnapshotWithDuplicateAssetIds() {
        properties.setBootstrapEnabled(true);
        when(sync.tryAcquireLock(anyString(), any())).thenReturn(true);
        when(sync.cursor()).thenReturn(Optional.empty());
        when(sync.startRun(any(), any())).thenReturn("bootstrap-duplicate");
        when(sync.eventExists(anyString())).thenReturn(false);
        JsonNode duplicate = mapper.createObjectNode().put("assetId", 7).put("assetCode", "PC-007");
        JsonNode firstPage = mapper.createObjectNode().put("hasNextPage", true)
            .set("list", mapper.createArrayNode().add(duplicate));
        JsonNode secondPage = mapper.createObjectNode().put("hasNextPage", false)
            .set("list", mapper.createArrayNode().add(duplicate));
        when(client.pageAssets(anyInt(), anyInt(), eq(true))).thenReturn(firstPage, secondPage);

        org.assertj.core.api.Assertions.assertThatThrownBy(service::run)
            .hasMessageContaining("duplicate or invalid asset IDs");

        verify(assets, never()).reconcileSourceSnapshot(anyString(), any());
        verify(sync).fail(eq("bootstrap-duplicate"), anyString(), eq(2), eq(2), eq(1));
    }
}
