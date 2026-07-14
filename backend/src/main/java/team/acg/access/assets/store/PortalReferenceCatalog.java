package team.acg.access.assets.store;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;
import java.util.Objects;

@Component
public class PortalReferenceCatalog {
    public static final String CATEGORY_KEY = "assetCategoryTree";
    public static final String LOCATION_KEY = "assetLocationTree";

    private final AppStoreRepository repository;

    public PortalReferenceCatalog(AppStoreRepository repository) {
        this.repository = repository;
    }

    public Set<String> categories() {
        return configuredValues(CATEGORY_KEY, "category");
    }

    public Set<String> locations() {
        return configuredValues(LOCATION_KEY, "location");
    }

    public ReferenceChange changes(String key, JsonNode nextTree) {
        if (!Set.of(CATEGORY_KEY, LOCATION_KEY).contains(key)) return ReferenceChange.none();
        JsonNode previousTree = repository.find(key).map(AppStoreRepository.StoreValue::value).orElse(null);
        Map<String, String> previous = flatten(key, previousTree);
        Map<String, String> next = flatten(key, nextTree);
        Map<String, NodeState> previousNodes = indexNodes(previousTree);
        Map<String, NodeState> nextNodes = indexNodes(nextTree);
        Set<String> nextValues = Set.copyOf(next.values());
        Map<String, String> replacements = new LinkedHashMap<>();
        Set<String> removed = new LinkedHashSet<>();

        previous.forEach((id, oldValue) -> {
            String nextValue = next.get(id);
            if (nextValue == null) {
                if (!nextValues.contains(oldValue)) removed.add(oldValue);
            } else if (!oldValue.equals(nextValue) && !nextValues.contains(oldValue)) {
                replacements.put(oldValue, nextValue);
            }
        });
        boolean created = nextNodes.keySet().stream().anyMatch(id -> !previousNodes.containsKey(id));
        boolean deleted = previousNodes.keySet().stream().anyMatch(id -> !nextNodes.containsKey(id));
        boolean updated = previousNodes.entrySet().stream().anyMatch(entry -> {
            NodeState nextNode = nextNodes.get(entry.getKey());
            return nextNode != null && (!Objects.equals(entry.getValue().parentId(), nextNode.parentId())
                || entry.getValue().position() != nextNode.position()
                || !Objects.equals(entry.getValue().content(), nextNode.content()));
        });
        boolean toggled = previousNodes.entrySet().stream().anyMatch(entry -> {
            NodeState nextNode = nextNodes.get(entry.getKey());
            return nextNode != null && entry.getValue().enabled() != nextNode.enabled();
        });
        return new ReferenceChange(
            CATEGORY_KEY.equals(key) ? "category" : "location",
            Map.copyOf(replacements), Set.copyOf(removed), nextValues, created, deleted, updated, toggled);
    }

    private Set<String> configuredValues(String key, String label) {
        return repository.find(key)
            .map(record -> Set.copyOf(flatten(key, record.value()).values()))
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                "Portal " + label + " catalog is not configured"));
    }

    static Map<String, String> flatten(String key, JsonNode tree) {
        Map<String, String> values = new LinkedHashMap<>();
        flattenNodes(key, tree, "", values);
        return values;
    }

    private static Map<String, NodeState> indexNodes(JsonNode tree) {
        Map<String, NodeState> nodes = new LinkedHashMap<>();
        indexNodes(tree, "", nodes);
        return nodes;
    }

    private static void indexNodes(JsonNode tree, String parentId, Map<String, NodeState> nodes) {
        if (tree == null || !tree.isArray()) return;
        for (int position = 0; position < tree.size(); position++) {
            JsonNode node = tree.get(position);
            if (!node.isObject()) continue;
            String id = text(node.path("id").asText());
            if (id.isEmpty()) continue;
            ObjectNode content = (ObjectNode) node.deepCopy();
            content.remove("children");
            boolean enabled = content.path("enabled").asBoolean(true);
            content.remove("enabled");
            nodes.put(id, new NodeState(parentId, position, content.toString(), enabled));
            indexNodes(node.path("children"), id, nodes);
        }
    }

    private static void flattenNodes(String key, JsonNode nodes, String parentPath, Map<String, String> values) {
        if (nodes == null || !nodes.isArray()) return;
        for (JsonNode node : nodes) {
            String id = text(node.path("id").asText());
            String name = text(node.path("name").asText());
            if (id.isEmpty() || name.isEmpty()) continue;
            String reference = LOCATION_KEY.equals(key) && !parentPath.isEmpty()
                ? parentPath + " / " + name : name;
            values.put(id, reference);
            flattenNodes(key, node.path("children"), LOCATION_KEY.equals(key) ? reference : "", values);
        }
    }

    private static String text(String value) {
        return value == null ? "" : value.trim();
    }

    private record NodeState(String parentId, int position, String content, boolean enabled) {}

    public record ReferenceChange(String field, Map<String, String> replacements, Set<String> removed,
                                  Set<String> allowedValues, boolean created, boolean deleted,
                                  boolean updated, boolean toggled) {
        static ReferenceChange none() {
            return new ReferenceChange("", Map.of(), Set.of(), Set.of(), false, false, false, false);
        }

        public boolean applies() {
            return !field.isEmpty();
        }
    }
}
