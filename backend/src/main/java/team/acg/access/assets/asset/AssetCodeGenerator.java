package team.acg.access.assets.asset;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Component;
import team.acg.access.assets.store.AppStoreRepository;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;

@Component
public class AssetCodeGenerator {
    private static final String SETTINGS_KEY = "assetPortalAssetCodeRuleSettingsV1";
    private static final String CATEGORY_KEY = "assetCategoryTree";
    private static final String LOCATION_KEY = "assetLocationTree";
    private final AppStoreRepository repository;

    public AssetCodeGenerator(AppStoreRepository repository) {
        this.repository = repository;
    }

    public String nextCode(JsonNode draft, Set<String> usedIds) {
        JsonNode settings = repository.find(SETTINGS_KEY).map(AppStoreRepository.StoreValue::value).orElse(null);
        int serialLength = settings == null ? 5 : Math.max(3, Math.min(7, settings.path("serialLength").asInt(5)));
        List<String> selectedFields = new ArrayList<>();
        if (settings != null && settings.path("selectedFields").isArray()) {
            settings.path("selectedFields").forEach(value -> selectedFields.add(value.asText()));
        }
        if (selectedFields.isEmpty()) selectedFields.add("categoryCode");

        StringBuilder prefix = new StringBuilder();
        for (String field : selectedFields) {
            String part = part(field, draft, settings);
            if (part.isEmpty()) continue;
            prefix.append(part).append(separator(settings, field));
        }
        if (prefix.isEmpty()) prefix.append("ASSET-");

        long maximum = (long) Math.pow(10, serialLength) - 1;
        long next = usedIds.stream().filter(id -> id.startsWith(prefix.toString()))
            .map(id -> id.substring(prefix.length()))
            .filter(value -> value.matches("[0-9]{" + serialLength + "}"))
            .mapToLong(Long::parseLong).max().orElse(0L) + 1;
        while (next <= maximum) {
            String candidate = prefix + String.format(Locale.ROOT, "%0" + serialLength + "d", next++);
            if (!usedIds.contains(candidate)) return candidate;
        }
        throw new IllegalStateException("Asset code sequence is exhausted for prefix: " + prefix);
    }

    private String part(String field, JsonNode draft, JsonNode settings) {
        return switch (field) {
            case "categoryCode" -> nodeCode(CATEGORY_KEY, draft.path("category").asText());
            case "locationCode" -> nodeCode(LOCATION_KEY, draft.path("location").asText());
            case "companyCode" -> token(draft.path("company").asText(draft.path("ownerCompany").asText()), 8);
            case "departmentCode" -> token(draft.path("department").asText(), 8);
            case "customText" -> token(settings == null ? "" : settings.path("customTexts").path("customText").asText(), 16);
            case "purchaseDate" -> purchaseDate(draft.path("purchaseDate").asText(), settings);
            default -> "";
        };
    }

    private String nodeCode(String key, String reference) {
        JsonNode tree = repository.find(key).map(AppStoreRepository.StoreValue::value).orElse(null);
        JsonNode node = findNode(tree, reference == null ? "" : reference.trim(), "", LOCATION_KEY.equals(key));
        if (node == null || !node.path("enabled").asBoolean(true)) return "";
        return token(node.path("code").asText(), 16);
    }

    private JsonNode findNode(JsonNode nodes, String reference, String parentPath, boolean usePath) {
        if (nodes == null || !nodes.isArray()) return null;
        for (JsonNode node : nodes) {
            String name = node.path("name").asText("").trim();
            String path = usePath && !parentPath.isEmpty() ? parentPath + " / " + name : name;
            if (reference.equals(path)) return node;
            JsonNode nested = findNode(node.path("children"), reference, usePath ? path : "", usePath);
            if (nested != null) return nested;
        }
        return null;
    }

    private String purchaseDate(String value, JsonNode settings) {
        LocalDate date;
        try {
            date = value == null || value.isBlank() ? LocalDate.now() : LocalDate.parse(value.trim());
        } catch (Exception error) {
            throw new IllegalArgumentException("Asset purchaseDate is invalid", error);
        }
        String format = settings == null ? "yyyymmdd" : settings.path("dateFormats").path("purchaseDate").asText("yyyymmdd");
        return switch (format) {
            case "yyyymm" -> date.format(DateTimeFormatter.ofPattern("yyyyMM"));
            case "yymmdd" -> date.format(DateTimeFormatter.ofPattern("yyMMdd"));
            case "yymm" -> date.format(DateTimeFormatter.ofPattern("yyMM"));
            default -> date.format(DateTimeFormatter.BASIC_ISO_DATE);
        };
    }

    private String separator(JsonNode settings, String field) {
        String option = settings == null ? "" : settings.path("fieldOptions").path(field).asText();
        return "dash".equals(option) ? "-" : "slash".equals(option) ? "/" : "";
    }

    private String token(String value, int maxLength) {
        String normalized = value == null ? "" : value.toUpperCase(Locale.ROOT).replaceAll("[^A-Z0-9]", "");
        return normalized.length() <= maxLength ? normalized : normalized.substring(0, maxLength);
    }
}
