package team.acg.access.assets.asset;

import java.util.Map;

final class AssetActionPermissionContract {
    private static final Map<String, String> PERMISSIONS = Map.ofEntries(
        Map.entry("delete", "asset:item:delete"),
        Map.entry("receive", "asset:receive_return:receive"),
        Map.entry("return", "asset:receive_return:return"),
        Map.entry("borrow", "asset:borrow_return:borrow"),
        Map.entry("borrow-return", "asset:borrow_return:return"),
        Map.entry("handover", "asset:receive_return:handover"),
        Map.entry("handover-sign", "asset:receive_return:sign"),
        Map.entry("handover-cancel", "asset:receive_return:cancel"),
        Map.entry("cancel-inbound", "asset:inbound:cancel"),
        Map.entry("borrow-delay", "asset:borrow_return:extend"),
        Map.entry("repair-start", "asset:repair:create"),
        Map.entry("repair-complete", "asset:repair:update"),
        Map.entry("batch-edit", "asset:item:batchUpdate"),
        Map.entry("edit", "asset:item:update"),
        Map.entry("update-import", "asset:item:updateImport"),
        Map.entry("receive-import", "asset:item:receiveImport"),
        Map.entry("reference-edit", "asset:item:update"));

    private AssetActionPermissionContract() {}

    static String requiredPermission(String action) {
        String permission = PERMISSIONS.get(action);
        if (permission == null) throw new IllegalArgumentException("Unsupported asset action: " + action);
        return permission;
    }
}
