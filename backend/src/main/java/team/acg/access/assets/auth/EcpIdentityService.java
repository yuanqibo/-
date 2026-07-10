package team.acg.access.assets.auth;

import com.idanchuang.ecp.api.common.model.session.EcpSessionContext;
import com.idanchuang.ecp.sdk.client.EcpClient;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

@Service
@ConditionalOnProperty(prefix = "ecp.sdk", name = "enabled", havingValue = "true")
public class EcpIdentityService {
    private final EcpClient client;
    private final Set<String> adminAccounts;

    public EcpIdentityService(EcpClient client, @Value("${asset-portal.admin-accounts}") String adminAccounts) {
        this.client = client;
        this.adminAccounts = Arrays.stream(adminAccounts.split(","))
            .map(EcpIdentityService::normalize).filter(value -> !value.isBlank()).collect(Collectors.toUnmodifiableSet());
    }

    public Map<String, Object> resolve(String token) {
        return normalize(client.session(token).context(), adminAccounts);
    }

    static Map<String, Object> normalize(EcpSessionContext context, Set<String> adminAccounts) {
        EcpSessionContext.User source = context.user();
        String email = text(source.email());
        String account = first(email, source.accountUnionId(), source.unionId(), source.externalId());
        String roleCode = roleCode(context, adminAccounts, account, email);
        String roleName = switch (roleCode) {
            case "super_admin" -> "超级管理员";
            case "admin" -> "普通管理员";
            default -> "普通员工";
        };
        String department = source.departments() == null || source.departments().isEmpty()
            ? first(source.companyName(), source.accountSetName(), "ECP组织")
            : first(source.departments().getFirst().name(), "ECP组织");
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
        user.put("externalSubject", "ecp:" + first(source.accountUnionId(), source.unionId(), account));
        user.put("bindStatus", "已绑定");
        user.put("avatar", text(source.avatar()));
        user.put("permissionCodes", context.permissionCodes() == null ? java.util.List.of() : context.permissionCodes());
        return user;
    }

    private static String roleCode(EcpSessionContext context, Set<String> adminAccounts, String account, String email) {
        if (adminAccounts.contains(normalize(account)) || adminAccounts.contains(normalize(email))) return "super_admin";
        Set<String> roles = context.roles() == null ? Set.of() : context.roles().stream()
            .flatMap(role -> java.util.stream.Stream.of(role.code(), role.name(), role.type()))
            .map(EcpIdentityService::normalize).collect(Collectors.toSet());
        Set<String> permissions = context.permissionCodes() == null ? Set.of() : context.permissionCodes().stream()
            .map(EcpIdentityService::normalize).collect(Collectors.toSet());
        if (roles.stream().anyMatch(Set.of("app_admin", "super_admin", "超级管理员", "应用管理员")::contains)
            || permissions.contains("authz:app_role:assign")) return "super_admin";
        if (roles.stream().anyMatch(Set.of("operator", "admin", "资产运营", "普通管理员")::contains)
            || permissions.contains("asset:create") || permissions.contains("asset:update")) return "admin";
        return "employee";
    }

    private static String first(String... values) {
        return Arrays.stream(values).map(EcpIdentityService::text).filter(value -> !value.isBlank()).findFirst().orElse("");
    }

    private static String text(String value) {
        return value == null ? "" : value.trim();
    }

    private static String normalize(String value) {
        return text(value).toLowerCase(Locale.ROOT);
    }
}
