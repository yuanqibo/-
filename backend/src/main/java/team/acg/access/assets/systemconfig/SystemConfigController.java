package team.acg.access.assets.systemconfig;

import com.fasterxml.jackson.databind.JsonNode;
import com.idanchuang.ecp.sdk.spring.annotation.RequirePermission;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/system")
public class SystemConfigController {
    private final SystemConfigService service;

    public SystemConfigController(SystemConfigService service) {
        this.service = service;
    }

    @GetMapping("/integrations")
    @RequirePermission(permissions = "asset:integration:view")
    public Map<String, List<IntegrationView>> listIntegrations() {
        return Map.of("items", service.listIntegrations());
    }

    @GetMapping("/integrations/{id}")
    @RequirePermission(permissions = "asset:integration:view")
    public IntegrationView getIntegration(@PathVariable String id) {
        return service.getIntegration(id);
    }

    @PostMapping("/integrations")
    @RequirePermission(permissions = "asset:integration:create")
    public ResponseEntity<IntegrationView> createIntegration(@RequestBody CreateIntegration command) {
        return ResponseEntity.status(HttpStatus.CREATED).body(service.createIntegration(command));
    }

    @PutMapping("/integrations/{id}")
    @RequirePermission(permissions = "asset:integration:update")
    public IntegrationView updateIntegration(@PathVariable String id, @RequestBody UpdateIntegration command) {
        return service.updateIntegration(id, command);
    }

    @GetMapping("/forms")
    @RequirePermission(permissions = "asset:form:view")
    public Map<String, List<FormView>> listForms() {
        return Map.of("items", service.listForms());
    }

    @GetMapping("/forms/{id}")
    @RequirePermission(permissions = "asset:form:view")
    public FormView getForm(@PathVariable String id) {
        return service.getForm(id);
    }

    @PostMapping("/forms")
    @RequirePermission(permissions = "asset:form:create")
    public ResponseEntity<FormView> createForm(@RequestBody CreateForm command) {
        return ResponseEntity.status(HttpStatus.CREATED).body(service.createForm(command));
    }

    @PutMapping("/forms/{id}")
    @RequirePermission(permissions = "asset:form:update")
    public FormView updateForm(@PathVariable String id, @RequestBody UpdateForm command) {
        return service.updateForm(id, command);
    }

    @DeleteMapping("/forms/{id}")
    @RequirePermission(permissions = "asset:form:delete")
    public ResponseEntity<Void> deleteForm(@PathVariable String id, @RequestParam Long expectedVersion) {
        service.deleteForm(id, expectedVersion);
        return ResponseEntity.noContent().build();
    }

    public record CreateIntegration(String code, String name, String provider, String baseUrl, Boolean enabled,
                                    JsonNode config, String secret) {}

    public record UpdateIntegration(String code, String name, String provider, String baseUrl, Boolean enabled,
                                    JsonNode config, String secret, Boolean clearSecret, Long expectedVersion) {}

    public record IntegrationView(String id, String code, String name, String provider, String baseUrl, boolean enabled,
                                  JsonNode config, boolean secretConfigured, long version, Instant createdAt, Instant updatedAt) {}

    public record CreateForm(String code, String name, String description, Boolean enabled, JsonNode schema) {}

    public record UpdateForm(String code, String name, String description, Boolean enabled, JsonNode schema,
                             Long expectedVersion) {}

    public record FormView(String id, String code, String name, String description, boolean enabled, JsonNode schema,
                           long version, Instant createdAt, Instant updatedAt) {}
}
