package team.acg.access.assets.store;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.Map;

@Component
public class PortalDefaultConfigInitializer implements ApplicationRunner {
    static final String DEFAULTS_RESOURCE = "portal-defaults.json";

    private final AppStoreRepository repository;
    private final PortalDocumentValidator validator;
    private final ObjectMapper mapper;

    public PortalDefaultConfigInitializer(AppStoreRepository repository, PortalDocumentValidator validator,
                                          ObjectMapper mapper) {
        this.repository = repository;
        this.validator = validator;
        this.mapper = mapper;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        initializeMissing();
    }

    @Transactional
    public int initializeMissing() {
        Map<String, JsonNode> defaults = loadDefaults();
        defaults.forEach(validator::validate);
        return repository.insertMissing(defaults);
    }

    private Map<String, JsonNode> loadDefaults() {
        ClassPathResource resource = new ClassPathResource(DEFAULTS_RESOURCE);
        try (var input = resource.getInputStream()) {
            JsonNode root = mapper.readTree(input);
            if (root == null || !root.isObject() || root.isEmpty()) {
                throw new IllegalStateException("Portal default configuration is empty");
            }
            Map<String, JsonNode> defaults = new LinkedHashMap<>();
            root.fields().forEachRemaining(entry -> defaults.put(entry.getKey(), entry.getValue()));
            return defaults;
        } catch (IOException error) {
            throw new IllegalStateException("Cannot load portal default configuration", error);
        }
    }
}
