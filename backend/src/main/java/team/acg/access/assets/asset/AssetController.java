package team.acg.access.assets.asset;

import com.fasterxml.jackson.databind.JsonNode;
import com.idanchuang.ecp.sdk.spring.annotation.RequirePermission;
import jakarta.servlet.http.HttpServletRequest;
import team.acg.access.assets.auth.RequestIdentityService;
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
    private final RequestIdentityService identityService;

    public AssetController(AssetService service, RequestIdentityService identityService) {
        this.service = service;
        this.identityService = identityService;
    }

    @GetMapping
    @RequirePermission(permissions = "asset:view")
    public Map<String, Object> list(HttpServletRequest request) {
        var identity = identityService.current(request);
        return Map.of("items", identity.map(service::listFor).orElseGet(service::list));
    }

    @PostMapping
    @RequirePermission(permissions = "asset:create")
    public Map<String, Object> create(@RequestBody CreateAssetRequest request) {
        return Map.of("item", service.create(request.item()));
    }

    @PostMapping("/import")
    @RequirePermission(permissions = "asset:assetImport")
    public Map<String, Object> importAssets(@RequestBody AssetImportRequest request) {
        List<JsonNode> items = service.createMany(request.items());
        return Map.of("items", items, "count", items.size());
    }

    @PostMapping("/commands/{action}")
    @RequirePermission(permissions = "asset:view")
    public Map<String, Object> command(@org.springframework.web.bind.annotation.PathVariable String action,
                                       @RequestBody AssetCommandRequest command,
                                       HttpServletRequest request) {
        identityService.requirePermission(request, permissionFor(action));
        return Map.of("items", service.execute(action, command.assetIds(), command.fields()));
    }

    private String permissionFor(String action) {
        return switch (action) {
            case "delete" -> "asset:delete";
            case "receive" -> "asset:receive";
            case "return" -> "asset:return";
            case "borrow" -> "asset:borrow";
            case "borrow-return" -> "asset:borrowReturn";
            case "handover" -> "asset:handover";
            case "handover-sign" -> "assetReceiveReturn:sign";
            case "handover-cancel", "cancel-inbound" -> "assetReceiveReturn:cancel";
            case "borrow-delay" -> "assetBorrowReturn:extend";
            case "batch-edit" -> "asset:batchUpdate";
            case "edit", "reference-edit" -> "asset:update";
            default -> throw new IllegalArgumentException("Unsupported asset action: " + action);
        };
    }

    public record CreateAssetRequest(JsonNode item) {}
    public record AssetImportRequest(List<JsonNode> items) {}
    public record AssetCommandRequest(List<String> assetIds, JsonNode fields) {}
}
