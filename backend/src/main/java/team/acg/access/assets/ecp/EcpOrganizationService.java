package team.acg.access.assets.ecp;

import com.idanchuang.ecp.api.common.model.accountset.AccountSetResponse;
import com.idanchuang.ecp.api.common.model.directory.EcpCompanyProfile;
import com.idanchuang.ecp.api.common.model.directory.EcpDepartmentProfile;
import com.idanchuang.ecp.api.common.model.directory.EcpUserProfile;
import com.idanchuang.ecp.sdk.client.EcpClient;
import com.idanchuang.ecp.sdk.client.EcpTransportClient;
import com.idanchuang.ecp.sdk.client.model.EcpPage;
import jakarta.annotation.PreDestroy;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

@Service
@ConditionalOnProperty(prefix = "ecp.sdk", name = "enabled", havingValue = "true")
public class EcpOrganizationService {
    private static final int PAGE_SIZE = 100;
    private static final int MAX_PAGES = 100;

    private final EcpClient client;
    private final EcpTransportClient transportClient;

    public EcpOrganizationService(EcpClient client,
                                  @Value("${ecp.sdk.base-url}") String baseUrl,
                                  @Value("${ecp.sdk.app-code}") String appCode,
                                  @Value("${ecp.sdk.app-secret}") String appSecret) {
        this.client = client;
        this.transportClient = EcpTransportClient.builder()
            .baseUrl(baseUrl)
            .appCode(appCode)
            .appSecret(appSecret)
            .applicationName("access-assets-organization")
            .build();
    }

    public OrganizationConsole load(String tenantId) {
        List<String> warnings = new ArrayList<>();
        List<AccountSetView> accountSets = loadAccountSets(tenantId, warnings);
        List<EcpCompanyProfile> companies = safeCompanies(warnings);
        List<EcpDepartmentProfile> departments = loadDepartments(warnings);
        List<EcpUserProfile> users = loadUsers(warnings);
        OrganizationBuilder builder = new OrganizationBuilder();
        companies.forEach(builder::addCompany);
        departments.forEach(builder::addDepartment);
        users.forEach(builder::addUser);
        return new OrganizationConsole(
            accountSets,
            builder.roots(),
            users.stream().map(UserView::from).toList(),
            new OrganizationCapabilities(
                false,
                false,
                false,
                "当前 ECP Java SDK 已开放账号集/公司/部门/成员读取；未开放管理台“立即同步、同步配置、账号集设置”的写接口，资产系统不会伪造这些操作。"),
            warnings,
            OffsetDateTime.now());
    }

    private List<AccountSetView> loadAccountSets(String tenantId, List<String> warnings) {
        String normalizedTenantId = text(tenantId);
        if (normalizedTenantId.isEmpty()) {
            warnings.add("当前 ECP session 没有 tenantId，无法读取租户账号集。");
            return List.of();
        }
        try {
            return transportClient.tenant(normalizedTenantId).accountSets().listAll().stream()
                .sorted(Comparator.comparing((AccountSetResponse value) -> value.sort() == null ? Integer.MAX_VALUE : value.sort())
                    .thenComparing(value -> text(value.name())))
                .map(AccountSetView::from)
                .toList();
        } catch (RuntimeException error) {
            warnings.add("ECP 账号集读取失败：" + readable(error));
            return List.of();
        }
    }

    private List<EcpCompanyProfile> safeCompanies(List<String> warnings) {
        try {
            return client.directory().companies().list();
        } catch (RuntimeException error) {
            warnings.add("ECP 公司目录读取失败：" + readable(error));
            return List.of();
        }
    }

    private List<EcpDepartmentProfile> loadDepartments(List<String> warnings) {
        List<EcpDepartmentProfile> items = new ArrayList<>();
        try {
            for (int page = 1; page <= MAX_PAGES; page++) {
                EcpPage<EcpDepartmentProfile> result = client.directory().departments().list(page, PAGE_SIZE);
                items.addAll(result.items());
                if (!result.hasNext()) break;
            }
        } catch (RuntimeException error) {
            warnings.add("ECP 部门目录读取失败：" + readable(error));
        }
        return items;
    }

    private List<EcpUserProfile> loadUsers(List<String> warnings) {
        List<EcpUserProfile> items = new ArrayList<>();
        try {
            for (int page = 1; page <= MAX_PAGES; page++) {
                EcpPage<EcpUserProfile> result = client.directory().users().list(page, PAGE_SIZE);
                items.addAll(result.items());
                if (!result.hasNext()) break;
            }
        } catch (RuntimeException error) {
            warnings.add("ECP 成员目录读取失败：" + readable(error));
        }
        return items;
    }

    @PreDestroy
    void close() {
        transportClient.close();
    }

    private static String readable(RuntimeException error) {
        String message = text(error.getMessage());
        return message.isEmpty() ? error.getClass().getSimpleName() : message;
    }

    private static String first(String... values) {
        for (String value : values) {
            String text = text(value);
            if (!text.isEmpty()) return text;
        }
        return "";
    }

    private static String text(String value) {
        return value == null ? "" : value.trim();
    }

    public record OrganizationConsole(List<AccountSetView> accountSets, List<OrganizationNode> roots,
                                      List<UserView> users, OrganizationCapabilities capabilities,
                                      List<String> warnings, OffsetDateTime fetchedAt) {}

    public record OrganizationCapabilities(boolean sync, boolean syncConfiguration, boolean accountSetSettings,
                                           String unavailableReason) {}

    public record AccountSetView(String unionId, String name, String code, String status, String sourceType,
                                 String setType, String configStatus, String syncMode, String syncStatus,
                                 Long syncVersion, Long dataVersion, OffsetDateTime lastSyncAt) {
        static AccountSetView from(AccountSetResponse value) {
            return new AccountSetView(value.unionId(), value.name(), value.code(), value.status(), value.sourceType(),
                value.setType(), value.configStatus(), value.syncMode(), value.syncStatus(), value.syncVersion(),
                value.dataVersion(), value.lastSyncAt());
        }
    }

    public record OrganizationNode(String key, String unionId, String externalId, String name, String nodeType,
                                   String path, String fullPath, String status, String sourceType,
                                   String accountSetUnionId, String companyUnionId, String parentUnionId,
                                   String leaderName, int level, List<String> directSubjects,
                                   List<String> memberSubjects, List<OrganizationNode> children) {}

    public record UserView(String subject, String unionId, String externalId, String accountSetUnionId,
                           String name, String email, String phone, String employeeNo, String jobTitle,
                           String status, String companyUnionId, String companyName, List<UserDepartmentView> departments) {
        static UserView from(EcpUserProfile profile) {
            EcpUserProfile.CompanySummary company = profile.company();
            return new UserView(
                first(profile.unionId(), profile.externalId()),
                profile.unionId(),
                profile.externalId(),
                profile.accountSetUnionId(),
                profile.name(),
                profile.email(),
                profile.phone(),
                profile.employeeNo(),
                profile.jobTitle(),
                profile.status(),
                company == null ? "" : company.unionId(),
                company == null ? "" : company.name(),
                profile.departments() == null ? List.of() : profile.departments().stream().map(UserDepartmentView::from).toList());
        }
    }

    public record UserDepartmentView(String unionId, String externalId, String name, String nodeType, String path,
                                     String leaderName) {
        static UserDepartmentView from(EcpUserProfile.DepartmentSummary value) {
            return new UserDepartmentView(value.unionId(), value.externalId(), value.name(), value.nodeType(), value.path(),
                value.leader() == null ? "" : value.leader().name());
        }
    }

    private static final class OrganizationBuilder {
        private final Map<String, MutableNode> nodes = new LinkedHashMap<>();
        private final List<MutableNode> roots = new ArrayList<>();

        void addCompany(EcpCompanyProfile company) {
            if (company == null) return;
            MutableNode node = companyNode(company.unionId(), company.name(), company.accountSetUnionId());
            node.externalId = text(company.externalId());
            node.status = text(company.status());
            node.sourceType = text(company.sourceType());
            node.accountSetUnionId = text(company.accountSetUnionId());
        }

        void addDepartment(EcpDepartmentProfile department) {
            if (department == null) return;
            String unionId = text(department.unionId());
            if (unionId.isEmpty()) return;
            MutableNode node = nodes.computeIfAbsent("department:" + unionId, key -> new MutableNode(key, unionId));
            node.externalId = text(department.externalId());
            node.name = first(department.name(), department.path(), unionId);
            node.nodeType = first(department.nodeType(), "department");
            node.path = text(department.path());
            node.fullPath = first(department.path(), department.name());
            node.status = text(department.status());
            node.sourceType = text(department.sourceType());
            node.accountSetUnionId = text(department.accountSetUnionId());
            node.companyUnionId = text(department.companyUnionId());
            node.parentUnionId = text(department.parentUnionId());
            node.leaderName = department.leader() == null ? "" : text(department.leader().name());

            MutableNode parent = null;
            if (!node.parentUnionId.isEmpty() && !Objects.equals(node.parentUnionId, node.companyUnionId)) {
                parent = nodes.computeIfAbsent("department:" + node.parentUnionId, key -> new MutableNode(key, node.parentUnionId));
            }
            if (parent == null) {
                parent = companyNode(node.companyUnionId, first(department.companyName(), "ECP组织"), node.accountSetUnionId);
            }
            parent.addChild(node);
        }

        void addUser(EcpUserProfile user) {
            if (user == null) return;
            String subject = first(user.unionId(), user.externalId());
            if (subject.isEmpty()) return;
            EcpUserProfile.CompanySummary company = user.company();
            MutableNode companyNode = company == null
                ? companyNode("", "ECP组织", user.accountSetUnionId())
                : companyNode(company.unionId(), company.name(), company.accountSetUnionId());
            if (user.departments() == null || user.departments().isEmpty()) {
                companyNode.directSubjects.add(subject);
                return;
            }
            for (EcpUserProfile.DepartmentSummary department : user.departments()) {
                String departmentUnionId = text(department.unionId());
                MutableNode departmentNode = departmentUnionId.isEmpty()
                    ? companyNode
                    : nodes.computeIfAbsent("department:" + departmentUnionId, key -> new MutableNode(key, departmentUnionId));
                if (departmentNode.name.isEmpty()) departmentNode.name = first(department.name(), department.path(), departmentUnionId);
                if (departmentNode.path.isEmpty()) departmentNode.path = text(department.path());
                if (departmentNode.fullPath.isEmpty()) departmentNode.fullPath = first(department.path(), department.name());
                if (departmentNode.nodeType.isEmpty()) departmentNode.nodeType = first(department.nodeType(), "department");
                if (departmentNode.parent == null && departmentNode != companyNode) companyNode.addChild(departmentNode);
                departmentNode.directSubjects.add(subject);
            }
        }

        List<OrganizationNode> roots() {
            roots.stream()
                .sorted(Comparator.comparing(node -> node.name, String.CASE_INSENSITIVE_ORDER))
                .forEach(node -> compute(node, 0));
            return roots.stream().map(MutableNode::toView).toList();
        }

        private Set<String> compute(MutableNode node, int level) {
            node.level = level;
            node.children.sort(Comparator.comparing(child -> child.name, String.CASE_INSENSITIVE_ORDER));
            node.memberSubjects.clear();
            node.memberSubjects.addAll(node.directSubjects);
            for (MutableNode child : node.children) {
                node.memberSubjects.addAll(compute(child, level + 1));
            }
            return node.memberSubjects;
        }

        private MutableNode companyNode(String unionId, String name, String accountSetUnionId) {
            String normalizedUnionId = text(unionId);
            String key = normalizedUnionId.isEmpty() ? "company:" + first(name, "ECP组织") : "company:" + normalizedUnionId;
            MutableNode node = nodes.computeIfAbsent(key, value -> {
                MutableNode created = new MutableNode(value, normalizedUnionId);
                created.nodeType = "company";
                roots.add(created);
                return created;
            });
            node.name = first(node.name, name, "ECP组织");
            node.fullPath = first(node.fullPath, node.name);
            node.accountSetUnionId = first(node.accountSetUnionId, accountSetUnionId);
            node.companyUnionId = first(node.companyUnionId, normalizedUnionId);
            return node;
        }
    }

    private static final class MutableNode {
        final String key;
        final String unionId;
        String externalId = "";
        String name = "";
        String nodeType = "";
        String path = "";
        String fullPath = "";
        String status = "";
        String sourceType = "";
        String accountSetUnionId = "";
        String companyUnionId = "";
        String parentUnionId = "";
        String leaderName = "";
        int level;
        MutableNode parent;
        final Set<String> directSubjects = new LinkedHashSet<>();
        final Set<String> memberSubjects = new LinkedHashSet<>();
        final List<MutableNode> children = new ArrayList<>();

        MutableNode(String key, String unionId) {
            this.key = key;
            this.unionId = unionId;
        }

        void addChild(MutableNode child) {
            if (child == this || children.contains(child)) return;
            if (child.parent != null) child.parent.children.remove(child);
            child.parent = this;
            children.add(child);
        }

        OrganizationNode toView() {
            return new OrganizationNode(key, unionId, externalId, name, nodeType, path, fullPath, status, sourceType,
                accountSetUnionId, companyUnionId, parentUnionId, leaderName, level,
                List.copyOf(directSubjects), List.copyOf(memberSubjects), children.stream().map(MutableNode::toView).toList());
        }
    }
}
