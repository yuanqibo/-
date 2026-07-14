package team.acg.access.assets.asset;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.idanchuang.ecp.sdk.spring.annotation.PermissionSpec;
import com.idanchuang.ecp.sdk.spring.annotation.RequireAnyPermission;
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
    private final AssetPartyResolver partyResolver;

    public AssetController(AssetService service, RequestIdentityService identityService, AssetPartyResolver partyResolver) {
        this.service = service;
        this.identityService = identityService;
        this.partyResolver = partyResolver;
    }

    @GetMapping
    @RequirePermission(permissions = "asset:item:view")
    public Map<String, Object> list(HttpServletRequest request) {
        var identity = identityService.current(request);
        return Map.of("items", identity.map(service::listFor).orElseGet(service::list));
    }

    @PostMapping
    @RequireAnyPermission({
        @PermissionSpec("asset:item:create"),
        @PermissionSpec("asset:item:copy")
    })
    public Map<String, Object> create(@RequestBody CreateAssetRequest request, HttpServletRequest servletRequest) {
        String sourceAssetId = request == null ? "" : text(request.sourceAssetId());
        if (!sourceAssetId.isEmpty()) {
            identityService.requirePermission(servletRequest, "asset:item:copy");
            return Map.of("item", service.copy(sourceAssetId, request.item(), actor(servletRequest)));
        }
        identityService.requirePermission(servletRequest, "asset:item:create");
        return Map.of("item", service.create(partyResolver.normalizeDraft(request == null ? null : request.item()), actor(servletRequest)));
    }

    @PostMapping("/import")
    @RequirePermission(permissions = "asset:item:assetImport")
    public Map<String, Object> importAssets(@RequestBody AssetImportRequest request, HttpServletRequest servletRequest) {
        List<JsonNode> drafts = request == null || request.items() == null
            ? null : request.items().stream().map(partyResolver::normalizeDraft).toList();
        List<JsonNode> items = service.createMany(drafts, actor(servletRequest));
        return Map.of("items", items, "count", items.size());
    }

    @PostMapping("/commands/{action}")
    @RequirePermission(permissions = "asset:item:view")
    public Map<String, Object> command(@org.springframework.web.bind.annotation.PathVariable String action,
                                       @RequestBody AssetCommandRequest command,
                                       HttpServletRequest request) {
        identityService.requirePermission(request, AssetActionPermissionContract.requiredPermission(action));
        ObjectNode fields = command.fields() != null && command.fields().isObject()
            ? (ObjectNode) command.fields().deepCopy() : JsonNodeFactory.instance.objectNode();
        identityService.current(request).ifPresent(identity -> {
            fields.put("operator", identity.name());
            fields.put("operatorAccount", identity.account());
            fields.put("operatorSubject", identity.directorySubject());
        });
        partyResolver.normalizeCommand(action, fields);
        return Map.of("items", service.execute(action, command.assetIds(), fields));
    }

    private String text(String value) {
        return value == null ? "" : value.trim();
    }

    private AssetService.Actor actor(HttpServletRequest request) {
        return identityService.current(request)
            .map(identity -> new AssetService.Actor(identity.name(), identity.account(), identity.directorySubject()))
            .orElse(AssetService.Actor.SYSTEM);
    }

    public record CreateAssetRequest(JsonNode item, String sourceAssetId) {}
    public record AssetImportRequest(List<JsonNode> items) {}
    public record AssetCommandRequest(List<String> assetIds, JsonNode fields) {}
}
