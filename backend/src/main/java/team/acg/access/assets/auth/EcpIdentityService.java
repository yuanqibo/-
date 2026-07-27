package team.acg.access.assets.auth;

import com.idanchuang.ecp.api.common.model.session.EcpSessionContext;
import com.idanchuang.ecp.sdk.client.EcpClient;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

@Service
@ConditionalOnProperty(prefix = "ecp.sdk", name = "enabled", havingValue = "true")
public class EcpIdentityService {
    private static final Set<String> ADMIN_ROLE_TYPES = Set.of("APP_ADMIN", "OPERATOR", "AUDITOR");

    private final EcpClient client;

    public EcpIdentityService(EcpClient client) {
        this.client = client;
    }

    public Map<String, Object> resolve(String token) {
        return normalize(client.session(token).context());
    }

    static Map<String, Object> normalize(EcpSessionContext context) {
        if (context == null || context.user() == null) {
            throw new IllegalStateException("ECP session identity is incomplete");
        }
        EcpSessionContext.User source = context.user();
        String email = text(source.email());
        String account = first(email, source.accountUnionId(), source.unionId(), source.externalId());
        String subject = first(source.accountUnionId(), source.unionId(), source.externalId());
        String directorySubject = first(source.unionId(), source.externalId(), source.accountUnionId());
        if (subject.isBlank() || directorySubject.isBlank()) {
            throw new IllegalStateException("ECP session has no stable user subject");
        }
        Set<String> permissionCodes = EmployeeSelfServiceAccess.merge(context.permissionCodes());
        Set<String> roleTypes = context.roles() == null ? Set.of() : context.roles().stream()
            .map(EcpSessionContext.Role::type).map(EcpIdentityService::text)
            .map(String::toUpperCase).filter(value -> !value.isBlank()).collect(Collectors.toUnmodifiableSet());
        Set<String> roleCodes = context.roles() == null ? Set.of() : context.roles().stream()
            .map(EcpSessionContext.Role::code).map(EcpIdentityService::text)
            .map(String::toUpperCase).filter(value -> !value.isBlank()).collect(Collectors.toUnmodifiableSet());
        String roleCode = roleCode(roleTypes, roleCodes);
        String roleName = switch (roleCode) {
            case "super_admin" -> "超级管理员";
            case "admin" -> "普通管理员";
            default -> "普通员工";
        };
        String department = source.departments() == null || source.departments().isEmpty()
            ? first(source.companyName(), source.accountSetName(), "ECP组织")
            : first(source.departments().get(0).name(), "ECP组织");
        String company = first(source.companyName(), source.accountSetName(), "默认公司");

        Map<String, Object> user = new LinkedHashMap<>();
        user.put("name", first(source.displayName(), source.name(), account));
        user.put("account", account);
        user.put("email", email);
        user.put("phone", text(source.phone()));
        user.put("department", department);
        user.put("company", company);
        user.put("roleCode", roleCode);
        user.put("roleName", roleName);
        user.put("managerRoleCode", "employee".equals(roleCode) ? "" : roleCode);
        user.put("managerRoleName", "employee".equals(roleCode) ? "" : roleName);
        user.put("scope", "employee".equals(roleCode) ? "本人资产、个人申请和审批状态" : "资产与系统管理");
        user.put("loginType", "ECP统一认证");
        user.put("identitySource", "ECP");
        user.put("subject", subject);
        user.put("directorySubject", directorySubject);
        user.put("externalSubject", "ecp:" + subject);
        user.put("tenantId", context.tenant() == null ? "" : text(context.tenant().authzTenantId()));
        user.put("companyUnionId", context.tenant() == null || context.tenant().selectedCompany() == null
            ? "" : text(context.tenant().selectedCompany().unionId()));
        user.put("departmentUnionIds", source.departments() == null ? java.util.List.of() : source.departments().stream()
            .map(EcpSessionContext.Department::unionId).filter(java.util.Objects::nonNull).toList());
        user.put("bindStatus", "已绑定");
        user.put("avatar", text(source.avatar()));
        user.put("permissionCodes", permissionCodes);
        user.put("roleTypes", roleTypes);
        user.put("roleCodes", roleCodes);
        return user;
    }

    private static String roleCode(Set<String> roleTypes, Set<String> roleCodes) {
        if (roleTypes.contains("APP_ADMIN") || roleCodes.contains("APP_ADMIN")) return "super_admin";
        if (roleTypes.stream().anyMatch(ADMIN_ROLE_TYPES::contains)
            || roleCodes.contains("OPERATOR") || roleCodes.contains("APP_AUDITOR")) return "admin";
        return "employee";
    }

    private static String first(String... values) {
        return Arrays.stream(values).map(EcpIdentityService::text).filter(value -> !value.isBlank()).findFirst().orElse("");
    }

    private static String text(String value) {
        return value == null ? "" : value.trim();
    }

}
