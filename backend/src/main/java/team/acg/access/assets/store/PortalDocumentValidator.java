package team.acg.access.assets.store;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Component;

import java.util.HashSet;
import java.util.Set;

@Component
public class PortalDocumentValidator {
    private static final int MAX_TREE_DEPTH = 10;
    private static final int MAX_TREE_NODES = 5_000;
    private static final Set<String> ASSIGNABLE_ROLES = Set.of("admin", "employee");

    public void validate(String key, JsonNode value) {
        switch (key) {
            case "assetCategoryTree", "assetLocationTree" -> validateTree(key, value);
            case "assetPortalRegisteredUsers" -> validateUsers(value);
            case "assetPortalRoleDefinitionsV3" -> validateRoles(value);
            case "assetPortalDeletedRoleUsersV1", "assetLabelCustomTemplatesV1" -> validateArraySize(key, value, 5_000);
            case "assetLabelPrintSettingsV2", "assetPortalAssetCodeRuleSettingsV1", "assetPortalSelfServiceSettingsV9" -> validateObjectSize(key, value);
            case "assetCategoryTreeVersion" -> validateVersion(value);
            default -> throw new IllegalArgumentException("Unsupported portal data document: " + key);
        }
    }

    private void validateTree(String key, JsonNode tree) {
        Set<String> ids = new HashSet<>();
        int count = visitNodes(key, tree, 1, ids);
        if (count > MAX_TREE_NODES) throw new IllegalArgumentException(key + " exceeds the node limit");
    }

    private int visitNodes(String key, JsonNode nodes, int depth, Set<String> ids) {
        if (!nodes.isArray()) throw new IllegalArgumentException(key + " must be an array");
        if (depth > MAX_TREE_DEPTH) throw new IllegalArgumentException(key + " exceeds the depth limit");
        int count = 0;
        for (JsonNode node : nodes) {
            if (!node.isObject()) throw new IllegalArgumentException(key + " nodes must be objects");
            String id = required(node, "id", 191);
            required(node, "name", 255);
            if (!ids.add(id)) throw new IllegalArgumentException(key + " contains duplicate id: " + id);
            count++;
            JsonNode children = node.get("children");
            if (children != null && !children.isNull()) count += visitNodes(key, children, depth + 1, ids);
            if (count > MAX_TREE_NODES) return count;
        }
        return count;
    }

    private void validateUsers(JsonNode users) {
        validateArraySize("assetPortalRegisteredUsers", users, 10_000);
        Set<String> accounts = new HashSet<>();
        for (JsonNode user : users) {
            if (!user.isObject()) throw new IllegalArgumentException("Registered users must be objects");
            String account = required(user, "account", 191).toLowerCase();
            required(user, "name", 255);
            String role = required(user, "roleCode", 32);
            if (!ASSIGNABLE_ROLES.contains(role)) throw new IllegalArgumentException("Role cannot be assigned locally: " + role);
            if (!accounts.add(account)) throw new IllegalArgumentException("Duplicate registered account: " + account);
        }
    }

    private void validateRoles(JsonNode roles) {
        if (!roles.isArray() || roles.size() > 100) throw new IllegalArgumentException("Role definitions exceed the limit");
        Set<String> ids = new HashSet<>();
        for (JsonNode role : roles) {
            if (!role.isObject()) throw new IllegalArgumentException("Role definitions must be objects");
            String id = required(role, "id", 64);
            required(role, "name", 128);
            if (!ids.add(id)) throw new IllegalArgumentException("Duplicate role id: " + id);
            JsonNode permissions = role.path("permissions");
            if (!permissions.isArray() || permissions.size() > 500) throw new IllegalArgumentException("Role permissions are invalid: " + id);
            for (JsonNode permission : permissions) {
                String code = permission.asText("");
                if (!code.matches("[A-Za-z][A-Za-z0-9_-]{0,63}:[A-Za-z][A-Za-z0-9_-]{0,63}")) {
                    throw new IllegalArgumentException("Invalid permission code: " + code);
                }
            }
        }
    }

    private void validateArraySize(String key, JsonNode value, int max) {
        if (!value.isArray() || value.size() > max) throw new IllegalArgumentException(key + " exceeds the item limit");
    }

    private void validateObjectSize(String key, JsonNode value) {
        if (!value.isObject() || value.size() > 200) throw new IllegalArgumentException(key + " is invalid");
    }

    private void validateVersion(JsonNode value) {
        if (!(value.isTextual() || value.isIntegralNumber())) throw new IllegalArgumentException("Category version is invalid");
    }

    private String required(JsonNode node, String field, int maxLength) {
        String value = node.path(field).asText("").trim();
        if (value.isBlank() || value.length() > maxLength) throw new IllegalArgumentException("Invalid required field: " + field);
        return value;
    }
}
