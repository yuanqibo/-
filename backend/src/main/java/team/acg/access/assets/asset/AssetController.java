package team.acg.access.assets.asset;

import com.fasterxml.jackson.databind.JsonNode;
import com.idanchuang.ecp.sdk.spring.annotation.RequirePermission;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/assets")
public class AssetController {
    private final AssetService service;

    public AssetController(AssetService service) {
        this.service = service;
    }

    @GetMapping
    @RequirePermission(permissions = "asset:view")
    public Map<String, Object> list() {
        return Map.of("items", service.list());
    }

    @PostMapping
    @RequirePermission(permissions = "asset:create")
    public Map<String, Object> create(@RequestBody CreateAssetRequest request) {
        return Map.of("item", service.create(request.item()));
    }

    @PostMapping("/import")
    @RequirePermission(permissions = "asset:create")
    public Map<String, Object> importAssets(@RequestBody AssetImportRequest request) {
        List<JsonNode> items = service.createMany(request.items());
        return Map.of("items", items, "count", items.size());
    }

    @PostMapping("/commands/{action}")
    @RequirePermission(permissions = "asset:update")
    public Map<String, Object> command(@org.springframework.web.bind.annotation.PathVariable String action,
                                       @RequestBody AssetCommandRequest request) {
        return Map.of("items", service.execute(action, request.assetIds(), request.fields()));
    }

    public record CreateAssetRequest(JsonNode item) {}
    public record AssetImportRequest(List<JsonNode> items) {}
    public record AssetCommandRequest(List<String> assetIds, JsonNode fields) {}
}
