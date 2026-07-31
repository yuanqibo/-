package team.acg.access.assets.asset;

import java.util.Map;
import java.util.Set;

final class AssetActionPermissionContract {
    private static final Map<String, Set<String>> PERMISSIONS = Map.ofEntries(
        Map.entry("delete", Set.of("asset:item:delete")),
        Map.entry("receive", Set.of("asset:receive_return:receive", "asset:item:receive")),
        Map.entry("return", Set.of("asset:receive_return:return", "asset:item:return")),
        Map.entry("borrow", Set.of("asset:borrow_return:borrow", "asset:item:borrow")),
        Map.entry("borrow-return", Set.of("asset:borrow_return:return", "asset:item:borrowReturn")),
        Map.entry("handover", Set.of("asset:receive_return:handover", "asset:item:handover")),
        Map.entry("handover-sign", Set.of("asset:receive_return:sign")),
        Map.entry("handover-cancel", Set.of("asset:receive_return:cancel")),
        Map.entry("receipt-sign", Set.of("asset:receive_return:sign")),
        Map.entry("receipt-reject", Set.of("asset:receive_return:sign")),
        Map.entry("receipt-cancel", Set.of("asset:receive_return:cancel")),
        Map.entry("cancel-inbound", Set.of("asset:inbound:cancel")),
        Map.entry("borrow-delay", Set.of("asset:borrow_return:extend")),
        Map.entry("repair-start", Set.of("asset:repair:create")),
        Map.entry("repair-complete", Set.of("asset:repair:update")),
        Map.entry("disposal-start", Set.of("asset:disposal:create")),
        Map.entry("disposal-complete", Set.of("asset:disposal:complete")),
        Map.entry("disposal-cancel", Set.of("asset:disposal:cancel")),
        Map.entry("batch-edit", Set.of("asset:item:batchUpdate")),
        Map.entry("edit", Set.of("asset:item:update")),
        Map.entry("update-import", Set.of("asset:item:updateImport")),
        Map.entry("receive-import", Set.of("asset:item:receiveImport")),
        Map.entry("reference-edit", Set.of("asset:item:update")));

    private AssetActionPermissionContract() {}

    static Set<String> requiredPermissions(String action) {
        Set<String> permissions = PERMISSIONS.get(action);
        if (permissions == null) throw new IllegalArgumentException("Unsupported asset action: " + action);
        return permissions;
    }
}
