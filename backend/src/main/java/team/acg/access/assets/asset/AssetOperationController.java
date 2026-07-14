package team.acg.access.assets.asset;

import com.fasterxml.jackson.databind.node.ObjectNode;
import com.idanchuang.ecp.sdk.spring.annotation.PermissionSpec;
import com.idanchuang.ecp.sdk.spring.annotation.RequireAnyPermission;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import team.acg.access.assets.auth.RequestIdentityService;

import java.util.List;
import java.util.Map;
import java.util.LinkedHashSet;
import java.util.Set;

@RestController
@RequestMapping("/api/asset-operations")
public class AssetOperationController {
    private final AssetOperationRepository repository;
    private final RequestIdentityService identityService;

    public AssetOperationController(AssetOperationRepository repository, RequestIdentityService identityService) {
        this.repository = repository;
        this.identityService = identityService;
    }

    @GetMapping
    @RequireAnyPermission({
        @PermissionSpec("asset:inbound:view"),
        @PermissionSpec("asset:receive_return:view"),
        @PermissionSpec("asset:borrow_return:view")
    })
    public Map<String, Object> list(HttpServletRequest request,
                                    @RequestParam(defaultValue = "1") int page,
                                    @RequestParam(defaultValue = "200") int size,
                                    @RequestParam(required = false) String type) {
        if (page < 1 || page > 10_000 || size < 1 || size > 500) {
            throw new IllegalArgumentException("Asset operation page must be positive and size cannot exceed 500");
        }
        var identity = identityService.current(request);
        Set<String> allowedTypes = allowedTypes(identity.orElse(null));
        if (type != null && !type.isBlank()) {
            String normalizedType = type.trim().toUpperCase();
            if (!allowedTypes.contains(normalizedType)) {
                throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Asset operation type is not allowed");
            }
            allowedTypes = Set.of(normalizedType);
        }
        Set<String> subjects = identity.isPresent() && !identity.get().manager()
            ? java.util.stream.Stream.of(identity.get().subject(), identity.get().directorySubject())
                .filter(value -> value != null && !value.isBlank()).collect(java.util.stream.Collectors.toUnmodifiableSet())
            : Set.of();
        List<ObjectNode> records = repository.findPage(allowedTypes, subjects, page, size);
        if (identity.isPresent()) {
            String subject = identity.get().subject();
            String directorySubject = identity.get().directorySubject();
            records = records.stream().map(record -> {
                ObjectNode view = record.deepCopy();
                String partySubject = view.path("partySubject").asText();
                view.put("canSign", "HANDOVER".equals(view.path("type").asText())
                    && "待签字".equals(view.path("status").asText())
                    && (partySubject.equals(subject) || partySubject.equals(directorySubject)));
                return view;
            }).toList();
        }
        return Map.of("items", records, "page", page, "size", size,
            "total", repository.countByTypes(allowedTypes, subjects));
    }

    private Set<String> allowedTypes(RequestIdentityService.Identity identity) {
        if (identity == null) return Set.of("INBOUND", "RECEIVE", "RETURN", "BORROW", "BORROW_RETURN", "HANDOVER");
        Set<String> types = new LinkedHashSet<>();
        if (identity.hasPermission("asset:inbound:view")) types.add("INBOUND");
        if (identity.hasPermission("asset:receive_return:view")) {
            types.add("RECEIVE");
            types.add("RETURN");
            types.add("HANDOVER");
        }
        if (identity.hasPermission("asset:borrow_return:view")) {
            types.add("BORROW");
            types.add("BORROW_RETURN");
        }
        return Set.copyOf(types);
    }

}
