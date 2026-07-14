package team.acg.access.assets.store;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Component;

import java.util.HashSet;
import java.util.Set;

@Component
public class PortalDocumentValidator {
    private static final int MAX_TREE_DEPTH = 10;
    private static final int MAX_TREE_NODES = 5_000;
    private static final int MAX_DOCUMENT_DEPTH = 20;
    private static final int MAX_DOCUMENT_NODES = 20_000;
    private static final int MAX_TEXT_LENGTH = 65_536;
    private static final int MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

    public void validate(String key, JsonNode value) {
        validateComplexity(key, value);
        switch (key) {
            case "assetCategoryTree", "assetLocationTree" -> validateTree(key, value);
            case "assetLabelCustomTemplatesV1" -> validateArraySize(key, value, 5_000);
            case "assetLabelPrintSettingsV2", "assetPortalAssetCodeRuleSettingsV1", "assetPortalSelfServiceSettingsV9" -> validateObjectSize(key, value);
            case "assetCategoryTreeVersion" -> validateVersion(value);
            default -> throw new IllegalArgumentException("Unsupported portal data document: " + key);
        }
    }

    private void validateComplexity(String key, JsonNode value) {
        if (value == null || value.isNull()) throw new IllegalArgumentException(key + " cannot be null");
        if (value.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8).length > MAX_DOCUMENT_BYTES) {
            throw new IllegalArgumentException(key + " exceeds the byte limit");
        }
        int nodes = countNodes(key, value, 0);
        if (nodes > MAX_DOCUMENT_NODES) throw new IllegalArgumentException(key + " exceeds the node limit");
    }

    private int countNodes(String key, JsonNode value, int depth) {
        if (depth > MAX_DOCUMENT_DEPTH) throw new IllegalArgumentException(key + " exceeds the depth limit");
        if (value.isTextual() && value.textValue().length() > MAX_TEXT_LENGTH) {
            throw new IllegalArgumentException(key + " contains an oversized text value");
        }
        int count = 1;
        if (value.isContainerNode()) {
            var children = value.elements();
            while (children.hasNext()) {
                count += countNodes(key, children.next(), depth + 1);
                if (count > MAX_DOCUMENT_NODES) return count;
            }
        }
        return count;
    }

    private void validateTree(String key, JsonNode tree) {
        Set<String> ids = new HashSet<>();
        Set<String> references = new HashSet<>();
        int count = visitNodes(key, tree, 1, ids, references, "");
        if (count > MAX_TREE_NODES) throw new IllegalArgumentException(key + " exceeds the node limit");
    }

    private int visitNodes(String key, JsonNode nodes, int depth, Set<String> ids, Set<String> references,
                           String parentPath) {
        if (!nodes.isArray()) throw new IllegalArgumentException(key + " must be an array");
        if (depth > MAX_TREE_DEPTH) throw new IllegalArgumentException(key + " exceeds the depth limit");
        int count = 0;
        for (JsonNode node : nodes) {
            if (!node.isObject()) throw new IllegalArgumentException(key + " nodes must be objects");
            String id = required(node, "id", 191);
            String name = required(node, "name", 255);
            if (!ids.add(id)) throw new IllegalArgumentException(key + " contains duplicate id: " + id);
            String reference = "assetLocationTree".equals(key) && !parentPath.isBlank()
                ? parentPath + " / " + name : name;
            if (!references.add(reference)) {
                throw new IllegalArgumentException(key + " contains duplicate asset reference: " + reference);
            }
            count++;
            JsonNode children = node.get("children");
            if (children != null && !children.isNull()) {
                count += visitNodes(key, children, depth + 1, ids, references,
                    "assetLocationTree".equals(key) ? reference : "");
            }
            if (count > MAX_TREE_NODES) return count;
        }
        return count;
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
