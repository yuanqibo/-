package team.acg.access.assets.systemconfig;

import com.idanchuang.ecp.sdk.spring.annotation.RequirePermission;
import org.junit.jupiter.api.Test;
import org.springframework.web.bind.annotation.DeleteMapping;

import java.lang.reflect.Method;
import java.util.Arrays;

import static org.assertj.core.api.Assertions.assertThat;

class SystemConfigPermissionContractTest {
    @Test
    void declaresFineGrainedEcpPermissionsForEverySystemConfigOperation() throws Exception {
        assertPermission("listIntegrations", "asset:integration:view");
        assertPermission("getIntegration", "asset:integration:view", String.class);
        assertPermission("createIntegration", "asset:integration:create", SystemConfigController.CreateIntegration.class);
        assertPermission("updateIntegration", "asset:integration:update", String.class, SystemConfigController.UpdateIntegration.class);
        assertPermission("listForms", "asset:form:view");
        assertPermission("getForm", "asset:form:view", String.class);
        assertPermission("createForm", "asset:form:create", SystemConfigController.CreateForm.class);
        assertPermission("updateForm", "asset:form:update", String.class, SystemConfigController.UpdateForm.class);
        assertPermission("deleteForm", "asset:form:delete", String.class, Long.class);

        assertThat(Arrays.stream(SystemConfigController.class.getDeclaredMethods())
            .filter(method -> method.isAnnotationPresent(DeleteMapping.class))
            .map(Method::getName)).containsExactly("deleteForm");
    }

    private void assertPermission(String methodName, String permission, Class<?>... parameterTypes) throws Exception {
        RequirePermission annotation = SystemConfigController.class.getMethod(methodName, parameterTypes)
            .getAnnotation(RequirePermission.class);
        assertThat(annotation).isNotNull();
        assertThat(annotation.permissions()).containsExactly(permission);
    }
}
