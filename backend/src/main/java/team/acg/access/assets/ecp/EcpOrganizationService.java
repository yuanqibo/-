package team.acg.access.assets.ecp;

import com.idanchuang.ecp.api.common.model.accountset.AccountSetResponse;
import com.idanchuang.ecp.api.common.model.directory.EcpCompanyProfile;
import com.idanchuang.ecp.api.common.model.directory.EcpDepartmentProfile;
import com.idanchuang.ecp.api.common.model.directory.EcpUserProfile;
import com.idanchuang.ecp.sdk.client.EcpClient;
import com.idanchuang.ecp.sdk.client.EcpTransportClient;
import com.idanchuang.ecp.sdk.client.model.EcpPage;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PreDestroy;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

import java.time.OffsetDateTime;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;

@Service
@ConditionalOnProperty(prefix = "ecp.sdk", name = "enabled", havingValue = "true")
public class EcpOrganizationService {
    private static final int PAGE_SIZE = 100;
    private static final int MAX_PAGES = 100;
    private static final long CACHE_TTL_MILLIS = Duration.ofMinutes(2).toMillis();

    private final EcpClient client;
    private final EcpTransportClient transportClient;
    private final HttpClient httpClient = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(10))
        .followRedirects(HttpClient.Redirect.NEVER)
        .build();
    private final ObjectMapper objectMapper;
    private final String baseUrl;
    private final EcpSelectableDirectoryService selectableDirectory;
    private final Map<String, CachedOrganization> organizations = new ConcurrentHashMap<>();

    public EcpOrganizationService(EcpClient client,
                                  ObjectMapper objectMapper,
                                  EcpSelectableDirectoryService selectableDirectory,
                                  @Value("${ecp.sdk.base-url}") String baseUrl,
                                  @Value("${ecp.sdk.app-code}") String appCode,
                                  @Value("${ecp.sdk.app-secret}") String appSecret) {
        this.client = client;
        this.objectMapper = objectMapper;
        this.selectableDirectory = selectableDirectory;
        this.baseUrl = baseUrl.replaceAll("/$", "");
        this.transportClient = EcpTransportClient.builder()
            .baseUrl(baseUrl)
            .appCode(appCode)
            .appSecret(appSecret)
            .applicationName("access-assets-organization")
            .build();
    }

    public OrganizationConsole load(String tenantId, String authorization) {
        String cacheKey = text(tenantId) + ":" + digest(text(authorization));
        long now = System.currentTimeMillis();
        CachedOrganization cached = organizations.compute(cacheKey, (ignored, current) -> {
            if (current != null && current.expiresAtMillis() > now) return current;
            return new CachedOrganization(loadFresh(tenantId, authorization),
                System.currentTimeMillis() + CACHE_TTL_MILLIS);
        });
        return cached.console();
    }

    private OrganizationConsole loadFresh(String tenantId, String authorization) {
        List<String> warnings = java.util.Collections.synchronizedList(new ArrayList<>());
        List<EcpCompanyProfile> companies;
        List<EcpDepartmentProfile> departments;
        List<EcpUserProfile> users;
        if (text(authorization).startsWith("Bearer ")) {
            try {
                EcpSelectableDirectoryService.DirectorySnapshot snapshot = selectableDirectory.snapshot(authorization);
                companies = snapshot.companies();
                departments = snapshot.departments();
                users = snapshot.users();
            } catch (RuntimeException error) {
                warnings.add("ECP 可选目录读取失败，已尝试应用目录：" + readable(error));
                DirectoryData fallback = loadApplicationDirectory(warnings);
                companies = fallback.companies();
                departments = fallback.departments();
                users = fallback.users();
            }
        } else {
            DirectoryData fallback = loadApplicationDirectory(warnings);
            companies = fallback.companies();
            departments = fallback.departments();
            users = fallback.users();
        }
        List<AccountSetView> accountSets = loadAccountSets(tenantId, authorization, companies, users, warnings);
        OrganizationBuilder builder = new OrganizationBuilder();
        companies.forEach(builder::addCompany);
        departments.forEach(builder::addDepartment);
        users.forEach(builder::addUser);
        return new OrganizationConsole(
            accountSets,
            builder.roots(),
            users.stream().map(UserView::from).toList(),
            new OrganizationCapabilities(
                true,
                true,
                true,
                ""),
            List.copyOf(warnings),
            OffsetDateTime.now());
    }

    private DirectoryData loadApplicationDirectory(List<String> warnings) {
        CompletableFuture<List<EcpCompanyProfile>> companiesFuture = CompletableFuture.supplyAsync(() -> safeCompanies(warnings));
        CompletableFuture<List<EcpDepartmentProfile>> departmentsFuture = CompletableFuture.supplyAsync(() -> loadDepartments(warnings));
        CompletableFuture<List<EcpUserProfile>> usersFuture = CompletableFuture.supplyAsync(() -> loadUsers(warnings));
        return new DirectoryData(companiesFuture.join(), departmentsFuture.join(), usersFuture.join());
    }

    private List<AccountSetView> loadAccountSets(String tenantId, String authorization, List<EcpCompanyProfile> companies,
                                                 List<EcpUserProfile> users, List<String> warnings) {
        List<AccountSetView> sessionAccountSets = loadAccountSetsWithSession(authorization);
        if (!sessionAccountSets.isEmpty()) return sessionAccountSets;

        String normalizedTenantId = text(tenantId);
        if (!normalizedTenantId.isEmpty()) {
            try {
                List<AccountSetView> appAccountSets = transportClient.tenant(normalizedTenantId).accountSets().listAll().stream()
                    .sorted(Comparator.comparing((AccountSetResponse value) -> value.sort() == null ? Integer.MAX_VALUE : value.sort())
                        .thenComparing(value -> text(value.name())))
                    .map(AccountSetView::from)
                    .toList();
                if (!appAccountSets.isEmpty()) return appAccountSets;
            } catch (RuntimeException ignored) {
                warnings.add("当前应用主体没有 ECP 账号集治理读取权限，已按 ECP 目录数据展示组织架构。");
            }
        }
        return deriveAccountSets(companies, users);
    }

    private List<AccountSetView> loadAccountSetsWithSession(String authorization) {
        String bearer = text(authorization);
        if (!bearer.startsWith("Bearer ")) return List.of();
        try {
            HttpRequest request = HttpRequest.newBuilder(URI.create(baseUrl + "/iam/account-sets?page=1&pageSize=100"))
                .timeout(Duration.ofSeconds(20))
                .header("Authorization", bearer)
                .header("Accept", "application/json")
                .header("Accept-Encoding", "identity")
                .GET()
                .build();
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() < 200 || response.statusCode() >= 300) return List.of();
            JsonNode root = objectMapper.readTree(response.body());
            JsonNode records = firstArray(root, "records", "items", "data", "list");
            if (records == null && root.isArray()) records = root;
            if (records == null) return List.of();
            List<AccountSetView> values = new ArrayList<>();
            records.forEach(node -> values.add(AccountSetView.from(node)));
            return values.stream()
                .filter(value -> !text(value.unionId()).isEmpty())
                .sorted(Comparator.comparing((AccountSetView value) -> text(value.name())))
                .toList();
        } catch (Exception ignored) {
            return List.of();
        }
    }

    private List<AccountSetView> deriveAccountSets(List<EcpCompanyProfile> companies, List<EcpUserProfile> users) {
        Map<String, AccountSetView> values = new LinkedHashMap<>();
        companies.forEach(company -> {
            String unionId = text(company.accountSetUnionId());
            if (!unionId.isEmpty()) values.putIfAbsent(unionId, new AccountSetView(unionId,
                first(company.sourceType(), "ECP账号集"), "", company.status(), company.sourceType(), "internal",
                "", "", "", null, null, null));
        });
        users.forEach(user -> {
            String unionId = text(user.accountSetUnionId());
            if (!unionId.isEmpty()) values.putIfAbsent(unionId, new AccountSetView(unionId,
                "ECP账号集", "", user.status(), "", "internal", "", "", "", null, null, null));
        });
        return List.copyOf(values.values());
    }

    private JsonNode firstArray(JsonNode root, String... names) {
        for (String name : names) {
            JsonNode node = root.path(name);
            if (node.isArray()) return node;
            if (node.has("records") && node.path("records").isArray()) return node.path("records");
            if (node.has("items") && node.path("items").isArray()) return node.path("items");
        }
        return null;
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

    private static String digest(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception error) {
            throw new IllegalStateException("SHA-256 is unavailable", error);
        }
    }

    public record OrganizationConsole(List<AccountSetView> accountSets, List<OrganizationNode> roots,
                                      List<UserView> users, OrganizationCapabilities capabilities,
                                      List<String> warnings, OffsetDateTime fetchedAt) {}

    private record CachedOrganization(OrganizationConsole console, long expiresAtMillis) {}

    private record DirectoryData(List<EcpCompanyProfile> companies,
                                 List<EcpDepartmentProfile> departments,
                                 List<EcpUserProfile> users) {}

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

        static AccountSetView from(JsonNode value) {
            return new AccountSetView(
                firstJson(value, "unionId", "accountSetUnionId", "id"),
                firstJson(value, "name", "accountSetName", "title"),
                firstJson(value, "code"),
                firstJson(value, "status"),
                firstJson(value, "sourceType", "source"),
                firstJson(value, "setType", "type"),
                firstJson(value, "configStatus"),
                firstJson(value, "syncMode"),
                firstJson(value, "syncStatus"),
                longJson(value, "syncVersion"),
                longJson(value, "dataVersion"),
                timeJson(value, "lastSyncAt"));
        }
    }

    private static String firstJson(JsonNode node, String... fields) {
        for (String field : fields) {
            String value = text(node.path(field).asText(""));
            if (!value.isEmpty() && !"null".equalsIgnoreCase(value)) return value;
        }
        return "";
    }

    private static Long longJson(JsonNode node, String field) {
        JsonNode value = node.path(field);
        return value.isNumber() ? value.asLong() : null;
    }

    private static OffsetDateTime timeJson(JsonNode node, String field) {
        String value = firstJson(node, field);
        if (value.isEmpty()) return null;
        try {
            return OffsetDateTime.parse(value);
        } catch (RuntimeException ignored) {
            return null;
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
