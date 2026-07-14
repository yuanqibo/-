package team.acg.access.assets.systemconfig;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

@Component
final class SystemConfigValidator {
    static final int MAX_INTEGRATION_CONFIG_BYTES = 32 * 1024;
    static final int MAX_FORM_SCHEMA_BYTES = 64 * 1024;
    private static final int MAX_JSON_DEPTH = 20;
    private static final int MAX_JSON_NODES = 2_000;
    private static final Pattern CODE = Pattern.compile("[a-z][a-z0-9._-]{0,63}");
    private static final Pattern PROVIDER = Pattern.compile("[a-z][a-z0-9_-]{0,39}");
    private static final Set<String> JSON_SCHEMA_TYPES = Set.of(
        "array", "boolean", "integer", "null", "number", "object", "string");
    private static final Set<String> SUPPORTED_SCHEMA_URIS = Set.of(
        "https://json-schema.org/draft/2020-12/schema",
        "https://json-schema.org/draft/2019-09/schema",
        "http://json-schema.org/draft-07/schema#",
        "http://json-schema.org/draft-06/schema#");

    private final ObjectMapper mapper;

    SystemConfigValidator(ObjectMapper mapper) {
        this.mapper = mapper;
    }

    String code(String value, String label) {
        String normalized = requiredText(value, 64, label);
        if (!CODE.matcher(normalized).matches()) {
            throw new IllegalArgumentException(label + " must start with a lowercase letter and contain only lowercase letters, digits, '.', '_' or '-'");
        }
        return normalized;
    }

    String provider(String value) {
        String normalized = requiredText(value, 40, "Integration provider");
        if (!PROVIDER.matcher(normalized).matches()) {
            throw new IllegalArgumentException("Integration provider must be a lowercase identifier");
        }
        return normalized;
    }

    String requiredText(String value, int maxLength, String label) {
        String normalized = value == null ? "" : value.trim();
        if (normalized.isEmpty()) throw new IllegalArgumentException(label + " is required");
        if (normalized.length() > maxLength) throw new IllegalArgumentException(label + " exceeds " + maxLength + " characters");
        rejectControlCharacters(normalized, label);
        return normalized;
    }

    String optionalText(String value, int maxLength, String label) {
        String normalized = value == null ? "" : value.trim();
        if (normalized.length() > maxLength) throw new IllegalArgumentException(label + " exceeds " + maxLength + " characters");
        rejectControlCharacters(normalized, label);
        return normalized;
    }

    String baseUrl(String value) {
        String normalized = requiredText(value, 2_048, "Integration base URL");
        final URI uri;
        try {
            uri = URI.create(normalized);
        } catch (IllegalArgumentException error) {
            throw new IllegalArgumentException("Integration base URL is invalid");
        }
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        if (!(scheme.equals("https") || scheme.equals("http"))) {
            throw new IllegalArgumentException("Integration base URL scheme must be http or https");
        }
        if (!uri.isAbsolute() || uri.getHost() == null || uri.getHost().isBlank()
            || uri.getUserInfo() != null || uri.getFragment() != null || uri.getQuery() != null) {
            throw new IllegalArgumentException("Integration base URL must be an absolute host URL without credentials, query or fragment");
        }
        return normalized;
    }

    JsonNode integrationConfig(JsonNode value) {
        JsonNode normalized = value == null || value.isNull() ? mapper.createObjectNode() : value.deepCopy();
        if (!normalized.isObject()) throw new IllegalArgumentException("Integration config must be a JSON object");
        validateJsonSizeAndShape(normalized, MAX_INTEGRATION_CONFIG_BYTES, "Integration config");
        rejectEmbeddedSecrets(normalized);
        return normalized;
    }

    JsonNode formSchema(JsonNode value) {
        if (value == null || value.isNull() || !value.isObject()) {
            throw new IllegalArgumentException("Form schema must be a JSON Schema object");
        }
        JsonNode normalized = value.deepCopy();
        validateJsonSizeAndShape(normalized, MAX_FORM_SCHEMA_BYTES, "Form schema");
        validateSchemaNode(normalized);
        return normalized;
    }

    String secret(String value) {
        if (value == null) return null;
        if (value.isBlank()) throw new IllegalArgumentException("Integration secret cannot be blank");
        if (value.getBytes(StandardCharsets.UTF_8).length > 4_096) {
            throw new IllegalArgumentException("Integration secret exceeds 4096 bytes");
        }
        return value;
    }

    long expectedVersion(Long version) {
        if (version == null || version < 1) throw new IllegalArgumentException("expectedVersion must be a positive integer");
        return version;
    }

    private void validateJsonSizeAndShape(JsonNode value, int maxBytes, String label) {
        final int bytes;
        try {
            bytes = mapper.writeValueAsBytes(value).length;
        } catch (Exception error) {
            throw new IllegalArgumentException(label + " cannot be serialized");
        }
        if (bytes > maxBytes) throw new IllegalArgumentException(label + " exceeds " + maxBytes + " bytes");
        int nodes = countNodes(value, 0);
        if (nodes > MAX_JSON_NODES) throw new IllegalArgumentException(label + " contains too many values");
    }

    private int countNodes(JsonNode value, int depth) {
        if (depth > MAX_JSON_DEPTH) throw new IllegalArgumentException("JSON nesting exceeds " + MAX_JSON_DEPTH + " levels");
        int count = 1;
        Iterator<JsonNode> children = value.elements();
        while (children.hasNext()) {
            count += countNodes(children.next(), depth + 1);
            if (count > MAX_JSON_NODES) return count;
        }
        return count;
    }

    private void rejectEmbeddedSecrets(JsonNode value) {
        if (value.isObject()) {
            Iterator<String> names = value.fieldNames();
            while (names.hasNext()) {
                String name = names.next();
                String compact = name.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]", "");
                if (compact.contains("secret") || compact.contains("password") || compact.contains("token")
                    || compact.contains("credential") || compact.contains("privatekey")
                    || compact.contains("accesskey") || compact.contains("apikey")) {
                    throw new IllegalArgumentException("Sensitive integration values must use the dedicated secret field");
                }
                rejectEmbeddedSecrets(value.get(name));
            }
        } else if (value.isArray()) {
            value.forEach(this::rejectEmbeddedSecrets);
        }
    }

    private void validateSchemaNode(JsonNode schema) {
        JsonNode schemaUri = schema.get("$schema");
        if (schemaUri != null) {
            if (!schemaUri.isTextual() || !SUPPORTED_SCHEMA_URIS.contains(schemaUri.asText())) {
                throw new IllegalArgumentException("Form schema uses an unsupported $schema URI");
            }
        }
        validateSchemaReferences(schema);
        JsonNode type = schema.get("type");
        if (type != null) validateSchemaType(type);
        JsonNode properties = schema.get("properties");
        if (properties != null && !properties.isObject()) {
            throw new IllegalArgumentException("Form schema properties must be an object");
        }
        JsonNode required = schema.get("required");
        if (required != null) {
            if (!required.isArray()) throw new IllegalArgumentException("Form schema required must be an array");
            Set<String> names = new HashSet<>();
            for (JsonNode item : required) {
                if (!item.isTextual() || item.asText().isBlank() || !names.add(item.asText())) {
                    throw new IllegalArgumentException("Form schema required must contain unique non-empty property names");
                }
            }
        }
    }

    private void validateSchemaReferences(JsonNode value) {
        if (value.isObject()) {
            JsonNode reference = value.get("$ref");
            if (reference != null && (!reference.isTextual()
                || !(reference.asText().equals("#") || reference.asText().startsWith("#/")))) {
                throw new IllegalArgumentException("Form schema only supports local $ref values");
            }
            value.elements().forEachRemaining(this::validateSchemaReferences);
        } else if (value.isArray()) {
            value.forEach(this::validateSchemaReferences);
        }
    }

    private void validateSchemaType(JsonNode type) {
        if (type.isTextual()) {
            if (!JSON_SCHEMA_TYPES.contains(type.asText())) throw new IllegalArgumentException("Form schema type is invalid");
            return;
        }
        if (!type.isArray() || type.isEmpty()) throw new IllegalArgumentException("Form schema type must be a string or non-empty array");
        Set<String> types = new HashSet<>();
        for (JsonNode item : type) {
            if (!item.isTextual() || !JSON_SCHEMA_TYPES.contains(item.asText()) || !types.add(item.asText())) {
                throw new IllegalArgumentException("Form schema type array is invalid");
            }
        }
    }

    private void rejectControlCharacters(String value, String label) {
        if (value.chars().anyMatch(character -> Character.isISOControl(character) && character != '\n' && character != '\t')) {
            throw new IllegalArgumentException(label + " contains control characters");
        }
    }
}
