package team.acg.access.assets.sync;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import team.acg.access.assets.asset.AssetRepository;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.HexFormat;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;

@Service
@ConditionalOnProperty(prefix = "asset-portal.legacy-asset-sync", name = "enabled", havingValue = "true")
public class LegacyAssetSyncService {
    private static final String SOURCE_SYSTEM = "bear-rental-ams";
    private final LegacyAmsClient client;
    private final LegacyAssetSyncProperties properties;
    private final LegacyAssetSyncRepository sync;
    private final LegacyAssetSyncWriter writer;
    private final ObjectMapper mapper;
    private final AssetRepository assets;
    private final AtomicBoolean running = new AtomicBoolean();
    private final String ownerId = UUID.randomUUID().toString();

    LegacyAssetSyncService(LegacyAmsClient client, LegacyAssetSyncProperties properties,
                           LegacyAssetSyncRepository sync, LegacyAssetSyncWriter writer,
                           ObjectMapper mapper, AssetRepository assets) {
        this.client = client;
        this.properties = properties;
        this.sync = sync;
        this.writer = writer;
        this.mapper = mapper;
        this.assets = assets;
    }

    void run() {
        if (!running.compareAndSet(false, true)) return;
        if (!sync.tryAcquireLock(ownerId, Instant.now().plusSeconds(21_600))) {
            running.set(false);
            return;
        }
        try {
            assets.lockForWrite();
            assets.backfillLegacyAssetCodes(SOURCE_SYSTEM, Instant.now());
            Instant cursor = sync.cursor().orElse(properties.getInitialCursor());
            Instant end = Instant.now().minus(properties.getSafetyDelay());
            if (cursor == null) {
                if (!properties.isBootstrapEnabled()) {
                    throw new IllegalStateException("Legacy asset sync initial cursor is not configured");
                }
                bootstrap(end);
                return;
            }
            Instant start = cursor.minus(properties.getOverlap());
            String runId = sync.startRun(start, end);
            int fetched = 0;
            int applied = 0;
            int failed = 0;
            try {
                JsonNode changes = client.queryAssetChanges(start, end);
                for (JsonNode change : changes) {
                    fetched++;
                    String sourceId = change.path("assetId").asText("");
                    int changeType = change.path("changeType").asInt(0);
                    if (sourceId.isBlank() || changeType < 1 || changeType > 3) continue;
                    String eventBaseKey = sourceId + ":" + changeType;
                    String eventKey = eventBaseKey;
                    try {
                        long sourceAssetId = Long.parseLong(sourceId);
                        assets.lockForWrite();
                        JsonNode detail = changeType == 3 ? null : client.queryAssetDetail(sourceAssetId);
                        String hash = hash(detail == null ? change : detail);
                        eventKey = sourceId + ":" + changeType + ":" + hash;
                        if (sync.eventExists(eventKey)) {
                            sync.resolveDeadLetters(eventBaseKey);
                            continue;
                        }
                        if (changeType == 3) writer.markDeleted(sourceAssetId, change.path("assetCode").asText(""), end);
                        else writer.upsert(detail, end);
                        sync.recordEvent(eventKey, sourceId, changeType, hash, runId);
                        sync.resolveDeadLetters(eventBaseKey);
                        applied++;
                    } catch (RuntimeException error) {
                        failed++;
                        sync.recordDeadLetter(eventBaseKey, sourceId, error.getMessage());
                    }
                }
                if (failed == 0) {
                    assets.lockForWrite();
                    assets.removeAssetsOutsideSource(SOURCE_SYSTEM);
                }
                sync.complete(runId, end, fetched, applied, failed);
            } catch (RuntimeException error) {
                sync.fail(runId, error.getMessage(), fetched, applied, failed + 1);
                throw error;
            }
        } finally {
            sync.releaseLock(ownerId);
            running.set(false);
        }
    }

    private void bootstrap(Instant syncedAt) {
        String runId = sync.startRun(syncedAt, syncedAt);
        int fetched = 0;
        int applied = 0;
        int failed = 0;
        Set<String> snapshotAssetIds = new LinkedHashSet<>();
        try {
            for (int page = 1; ; page++) {
                JsonNode result = client.pageAssets(page, Math.max(1, Math.min(properties.getPageSize(), 500)), true);
                JsonNode items = result.path("list");
                if (!items.isArray()) throw new IllegalStateException("Legacy AMS pageAsset response has no list");
                for (JsonNode summary : items) {
                    fetched++;
                    String sourceId = summary.path("assetId").asText("");
                    String eventBaseKey = "bootstrap:" + sourceId;
                    String eventKey = eventBaseKey;
                    try {
                        if (sourceId.isBlank()) throw new IllegalArgumentException("Legacy asset page item has no assetId");
                        snapshotAssetIds.add("legacy-asset-" + sourceId);
                        // pageAsset already contains the full asset snapshot needed by the target model.
                        String hash = hash(summary);
                        eventKey = eventKey + ":" + hash;
                        if (sync.eventExists(eventKey)) {
                            sync.resolveDeadLetters(eventBaseKey);
                            continue;
                        }
                        assets.lockForWrite();
                        writer.upsert(summary, syncedAt);
                        sync.recordEvent(eventKey, sourceId, 1, hash, runId);
                        sync.resolveDeadLetters(eventBaseKey);
                        applied++;
                    } catch (RuntimeException error) {
                        failed++;
                        sync.recordDeadLetter(eventBaseKey, sourceId, error.getMessage());
                    }
                }
                if (!result.path("hasNextPage").asBoolean(false)) break;
            }
            if (failed == 0 && snapshotAssetIds.size() != fetched) {
                throw new IllegalStateException("Legacy AMS pageAsset snapshot contains duplicate or invalid asset IDs");
            }
            if (failed == 0) {
                assets.lockForWrite();
                assets.reconcileSourceSnapshot(SOURCE_SYSTEM, snapshotAssetIds);
            }
            sync.complete(runId, syncedAt, fetched, applied, failed);
        } catch (RuntimeException error) {
            sync.fail(runId, error.getMessage(), fetched, applied, failed + 1);
            throw error;
        }
    }

    private String hash(JsonNode value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                .digest(value.toString().getBytes(StandardCharsets.UTF_8)));
        } catch (Exception error) {
            throw new IllegalStateException("Unable to hash legacy sync event", error);
        }
    }
}
