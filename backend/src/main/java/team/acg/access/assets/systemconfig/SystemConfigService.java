package team.acg.access.assets.systemconfig;

import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Service
final class SystemConfigService {
    private final SystemIntegrationRepository integrations;
    private final FormDefinitionRepository forms;
    private final SystemConfigValidator validator;
    private final SystemConfigSecretCipher secretCipher;

    SystemConfigService(SystemIntegrationRepository integrations, FormDefinitionRepository forms,
                        SystemConfigValidator validator, SystemConfigSecretCipher secretCipher) {
        this.integrations = integrations;
        this.forms = forms;
        this.validator = validator;
        this.secretCipher = secretCipher;
    }

    List<SystemConfigController.IntegrationView> listIntegrations() {
        return integrations.findAll().stream().map(this::view).toList();
    }

    SystemConfigController.IntegrationView getIntegration(String id) {
        return view(requireIntegration(id));
    }

    SystemConfigController.IntegrationView createIntegration(SystemConfigController.CreateIntegration command) {
        String secret = validator.secret(command.secret());
        Instant now = Instant.now();
        var value = new SystemIntegrationRepository.IntegrationRecord(
            UUID.randomUUID().toString(),
            validator.code(command.code(), "Integration code"),
            validator.requiredText(command.name(), 100, "Integration name"),
            validator.provider(command.provider()),
            validator.baseUrl(command.baseUrl()),
            command.enabled() == null || command.enabled(),
            validator.integrationConfig(command.config()),
            secret == null ? null : secretCipher.encrypt(secret),
            1L,
            now,
            now);
        try {
            return view(integrations.create(value));
        } catch (DuplicateKeyException error) {
            throw conflict("Integration code already exists");
        }
    }

    SystemConfigController.IntegrationView updateIntegration(String id, SystemConfigController.UpdateIntegration command) {
        long expectedVersion = validator.expectedVersion(command.expectedVersion());
        var current = requireIntegration(id);
        String suppliedSecret = validator.secret(command.secret());
        if (Boolean.TRUE.equals(command.clearSecret()) && suppliedSecret != null) {
            throw new IllegalArgumentException("secret and clearSecret cannot be supplied together");
        }
        String encryptedSecret = current.secretCiphertext();
        if (Boolean.TRUE.equals(command.clearSecret())) encryptedSecret = null;
        else if (suppliedSecret != null) encryptedSecret = secretCipher.encrypt(suppliedSecret);

        var value = new SystemIntegrationRepository.IntegrationRecord(
            current.id(),
            validator.code(command.code(), "Integration code"),
            validator.requiredText(command.name(), 100, "Integration name"),
            validator.provider(command.provider()),
            validator.baseUrl(command.baseUrl()),
            command.enabled() != null ? command.enabled() : current.enabled(),
            validator.integrationConfig(command.config()),
            encryptedSecret,
            current.version(),
            current.createdAt(),
            Instant.now());
        try {
            return integrations.update(value, expectedVersion).map(this::view)
                .orElseThrow(() -> conflict("Integration version conflict"));
        } catch (DuplicateKeyException error) {
            throw conflict("Integration code already exists");
        }
    }

    List<SystemConfigController.FormView> listForms() {
        return forms.findAll().stream().map(this::view).toList();
    }

    SystemConfigController.FormView getForm(String id) {
        return view(requireForm(id));
    }

    SystemConfigController.FormView createForm(SystemConfigController.CreateForm command) {
        Instant now = Instant.now();
        var value = new FormDefinitionRepository.FormRecord(
            UUID.randomUUID().toString(),
            validator.code(command.code(), "Form code"),
            validator.requiredText(command.name(), 100, "Form name"),
            validator.optionalText(command.description(), 1_000, "Form description"),
            command.enabled() == null || command.enabled(),
            validator.formSchema(command.schema()),
            1L,
            now,
            now);
        try {
            return view(forms.create(value));
        } catch (DuplicateKeyException error) {
            throw conflict("Form code already exists");
        }
    }

    SystemConfigController.FormView updateForm(String id, SystemConfigController.UpdateForm command) {
        long expectedVersion = validator.expectedVersion(command.expectedVersion());
        var current = requireForm(id);
        var value = new FormDefinitionRepository.FormRecord(
            current.id(),
            validator.code(command.code(), "Form code"),
            validator.requiredText(command.name(), 100, "Form name"),
            validator.optionalText(command.description(), 1_000, "Form description"),
            command.enabled() != null ? command.enabled() : current.enabled(),
            validator.formSchema(command.schema()),
            current.version(),
            current.createdAt(),
            Instant.now());
        try {
            return forms.update(value, expectedVersion).map(this::view)
                .orElseThrow(() -> conflict("Form version conflict"));
        } catch (DuplicateKeyException error) {
            throw conflict("Form code already exists");
        }
    }

    void deleteForm(String id, Long expectedVersionValue) {
        long expectedVersion = validator.expectedVersion(expectedVersionValue);
        requireForm(id);
        if (forms.delete(id, expectedVersion) == 0) throw conflict("Form version conflict");
    }

    private SystemIntegrationRepository.IntegrationRecord requireIntegration(String id) {
        return integrations.findById(id)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "System integration not found"));
    }

    private FormDefinitionRepository.FormRecord requireForm(String id) {
        return forms.findById(id)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Form definition not found"));
    }

    private SystemConfigController.IntegrationView view(SystemIntegrationRepository.IntegrationRecord value) {
        return new SystemConfigController.IntegrationView(value.id(), value.code(), value.name(), value.provider(), value.baseUrl(),
            value.enabled(), value.config(), value.secretCiphertext() != null, value.version(), value.createdAt(), value.updatedAt());
    }

    private SystemConfigController.FormView view(FormDefinitionRepository.FormRecord value) {
        return new SystemConfigController.FormView(value.id(), value.code(), value.name(), value.description(), value.enabled(),
            value.schema(), value.version(), value.createdAt(), value.updatedAt());
    }

    private ResponseStatusException conflict(String message) {
        return new ResponseStatusException(HttpStatus.CONFLICT, message);
    }
}
