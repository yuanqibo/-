package team.acg.access.assets.auth;

import com.idanchuang.ecp.api.common.model.session.EcpSessionContext;
import com.idanchuang.ecp.api.common.model.role.ApplicationRole;
import com.idanchuang.ecp.api.common.model.role.ApplicationRoleAssignment;
import com.idanchuang.ecp.sdk.client.EcpClient;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.beans.factory.annotation.Value;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.util.Arrays;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

@Service
@ConditionalOnProperty(prefix = "ecp.sdk", name = "enabled", havingValue = "true")
public class EcpIdentityService {
    private static final Logger log = LoggerFactory.getLogger(EcpIdentityService.class);
    private static final Set<String> ADMIN_ROLE_TYPES = Set.of("APP_ADMIN", "OPERATOR", "AUDITOR");

    private final EcpClient client;
    private final long cacheTtlMillis;
    private final boolean authoritativeRoleLookupEnabled;
    private final Map<String, CachedIdentity> identityCache = new ConcurrentHashMap<>();

    public EcpIdentityService(EcpClient client,
                              @Value("${asset-portal.security.identity-cache-ttl:1m}") Duration cacheTtl,
                              @Value("${ecp.sdk.permission.enabled:false}") boolean authoritativeRoleLookupEnabled) {
        this.client = client;
        this.cacheTtlMillis = Math.max(0, cacheTtl.toMillis());
        this.authoritativeRoleLookupEnabled = authoritativeRoleLookupEnabled;
    }

    public Map<String, Object> resolve(String token) {
        if (cacheTtlMillis == 0) return resolveFresh(token);
        long now = System.currentTimeMillis();
        String cacheKey = tokenFingerprint(token);
        CachedIdentity cached = identityCache.compute(cacheKey, (key, current) -> {
            if (current != null && current.expiresAtMillis() > now) return current;
            Map<String, Object> identity = Map.copyOf(resolveFresh(token));
            return new CachedIdentity(identity, System.currentTimeMillis() + cacheTtlMillis);
        });
        if (identityCache.size() > 256) {
            identityCache.entrySet().removeIf(entry -> entry.getValue().expiresAtMillis() <= now);
        }
        return cached.identity();
    }

    public void invalidateAll() {
        identityCache.clear();
    }

    private Map<String, Object> resolveFresh(String token) {
        EcpSessionContext context = client.session(token).context();
        Map<String, Object> identity = normalize(context);
        if (!authoritativeRoleLookupEnabled) return identity;
        try {
            mergeAuthoritativeAccountRoles(identity, context.user(), loadAccountRoles(context.user()));
        } catch (RuntimeException error) {
            log.warn("Unable to reconcile ECP account role assignments for {}", identity.get("directorySubject"), error);
        }
        return identity;
    }

    private String tokenFingerprint(String token) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                .digest(token.getBytes(StandardCharsets.UTF_8));
            return java.util.HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException error) {
            throw new IllegalStateException("SHA-256 is unavailable", error);
        }
    }

    private List<ApplicationRole> loadAccountRoles(EcpSessionContext.User user) {
        Map<Long, ApplicationRole> rolesById = client.roles().list().stream()
            .filter(role -> role.id() != null)
            .collect(Collectors.toMap(ApplicationRole::id, role -> role, (left, right) -> left, HashMap::new));
        Set<String> subjectKeys = new LinkedHashSet<>();
        for (String subject : List.of(text(user.accountUnionId()), text(user.unionId()), text(user.externalId()))) {
            if (!subject.isBlank()) subjectKeys.add("account:" + subject);
        }
        Map<Long, ApplicationRoleAssignment> assignmentsById = new LinkedHashMap<>();
        for (String subjectKey : subjectKeys) {
            for (ApplicationRoleAssignment assignment : client.roles().assignments().list(subjectKey, null)) {
                if (assignment.id() != null) assignmentsById.putIfAbsent(assignment.id(), assignment);
            }
        }
        return assignmentsById.values().stream()
            .map(ApplicationRoleAssignment::appRoleId)
            .map(rolesById::get)
            .filter(java.util.Objects::nonNull)
            .filter(role -> !"disabled".equalsIgnoreCase(text(role.status())))
            .toList();
    }

    static void mergeAuthoritativeAccountRoles(Map<String, Object> identity, EcpSessionContext.User user,
                                               Collection<ApplicationRole> assignedRoles) {
        if (assignedRoles == null || assignedRoles.isEmpty()) return;
        Set<String> roleCodes = stringSet(identity.get("roleCodes"));
        Set<String> roleTypes = stringSet(identity.get("roleTypes"));
        Set<String> permissions = stringSet(identity.get("permissionCodes"));
        Set<String> features = stringSet(identity.get("featureCodes"));
        for (ApplicationRole role : assignedRoles) {
            add(roleCodes, role.code());
            add(roleTypes, role.roleTypeCode());
            addAll(permissions, role.effectivePermissionCodes());
            addAll(features, role.effectiveFeatureCodes());
        }
        String roleCode = roleCode(roleTypes, roleCodes);
        String roleName = switch (roleCode) {
            case "super_admin" -> "超级管理员";
            case "admin" -> "普通管理员";
            default -> "普通员工";
        };
        identity.put("roleCode", roleCode);
        identity.put("roleName", roleName);
        identity.put("managerRoleCode", "employee".equals(roleCode) ? "" : roleCode);
        identity.put("managerRoleName", "employee".equals(roleCode) ? "" : roleName);
        identity.put("scope", "employee".equals(roleCode) ? "本人资产、个人申请和审批状态" : "资产与系统管理");
        identity.put("roleCodes", Set.copyOf(roleCodes));
        identity.put("roleTypes", Set.copyOf(roleTypes));
        identity.put("permissionCodes", Set.copyOf(permissions));
        identity.put("featureCodes", Set.copyOf(features));
        identity.put("roleAssignmentReconciled", true);
        identity.put("directorySubject", first(user.unionId(), user.externalId(), user.accountUnionId()));
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
        user.put("featureCodes", context.features() == null ? Set.of() : context.features().stream()
            .map(EcpSessionContext.Feature::code).map(EcpIdentityService::text)
            .filter(value -> !value.isBlank()).collect(Collectors.toUnmodifiableSet()));
        user.put("roleTypes", roleTypes);
        user.put("roleCodes", roleCodes);
        return user;
    }

    private static Set<String> stringSet(Object value) {
        Set<String> result = new LinkedHashSet<>();
        if (value instanceof Collection<?> values) {
            values.stream().map(EcpIdentityService::text).filter(item -> !item.isBlank()).forEach(result::add);
        }
        return result;
    }

    private static void add(Set<String> target, String value) {
        String normalized = text(value).toUpperCase();
        if (!normalized.isBlank()) target.add(normalized);
    }

    private static void addAll(Set<String> target, Collection<String> values) {
        if (values == null) return;
        values.stream().map(EcpIdentityService::text).filter(value -> !value.isBlank()).forEach(target::add);
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

    private static String text(Object value) {
        return value == null ? "" : value.toString().trim();
    }

    private record CachedIdentity(Map<String, Object> identity, long expiresAtMillis) {}

}
