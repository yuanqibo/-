package team.acg.access.assets.sync;

import com.idanchuang.ecp.sdk.spring.annotation.RequirePermission;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;

import java.util.Map;
import java.util.LinkedHashMap;

@RestController
@RequestMapping("/api/system/legacy-asset-sync")
@ConditionalOnProperty(prefix = "asset-portal.legacy-asset-sync", name = "enabled", havingValue = "true")
public class LegacyAssetSyncController {
    private final LegacyAssetSyncRepository repository;
    private final LegacyAssetSyncProperties properties;
    private final LegacyAssetSyncService service;

    LegacyAssetSyncController(LegacyAssetSyncRepository repository, LegacyAssetSyncProperties properties,
                              LegacyAssetSyncService service) {
        this.repository = repository;
        this.properties = properties;
        this.service = service;
    }

    @GetMapping("/status")
    @RequirePermission(permissions = "asset:integration:view")
    public Map<String, Object> status() {
        Map<String, Object> status = new LinkedHashMap<>(repository.status());
        status.put("sourceSystem", "bear-rental-ams");
        status.put("sourceOfTruth", "legacy-ams");
        status.put("readOnly", properties.isReadOnly());
        status.put("schedule", properties.getCron());
        status.put("timeZone", properties.getZone());
        return status;
    }

    @GetMapping("/history")
    @RequirePermission(permissions = "asset:integration:view")
    public Map<String, Object> history(@RequestParam(defaultValue = "20") int limit) {
        return Map.of("items", repository.history(limit));
    }

    @GetMapping("/dead-letters")
    @RequirePermission(permissions = "asset:integration:view")
    public Map<String, Object> deadLetters(@RequestParam(defaultValue = "100") int limit) {
        return Map.of("items", repository.deadLetters(limit));
    }

    @PostMapping("/dead-letters/{id}/retry")
    @RequirePermission(permissions = "asset:integration:update")
    public Map<String, Object> retryDeadLetter(@PathVariable String id) {
        if (id == null || id.isBlank() || !repository.retryDeadLetter(id.trim())) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Legacy sync dead letter was not found");
        }
        return Map.of("retried", true, "deadLetterId", id.trim());
    }

    @PostMapping("/run")
    @RequirePermission(permissions = "asset:integration:update")
    public Map<String, Object> runNow() {
        service.run();
        return status();
    }
}
