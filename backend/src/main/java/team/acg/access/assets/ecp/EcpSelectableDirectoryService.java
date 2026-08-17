package team.acg.access.assets.ecp;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.idanchuang.ecp.api.common.model.directory.EcpCompanyProfile;
import com.idanchuang.ecp.api.common.model.directory.EcpDepartmentProfile;
import com.idanchuang.ecp.api.common.model.directory.EcpUserProfile;
import com.idanchuang.ecp.sdk.client.EcpClient;
import com.idanchuang.ecp.sdk.client.model.EcpPage;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.util.UriComponentsBuilder;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.Deque;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

@Service
@ConditionalOnProperty(prefix = "ecp.sdk", name = "enabled", havingValue = "true")
public class EcpSelectableDirectoryService {
    private static final int PAGE_SIZE = 100;
    private static final int MAX_PAGES = 100;
    private static final int MAX_ORGANIZATION_NODES = 2_000;
    private static final long CACHE_TTL_MILLIS = Duration.ofMinutes(2).toMillis();
    private static final long PROFILE_CACHE_TTL_MILLIS = Duration.ofMinutes(5).toMillis();
    private static final long PROFILE_HYDRATION_BACKOFF_MILLIS = Duration.ofMinutes(1).toMillis();

    private final EcpClient directoryClient;
    private final HttpClient httpClient;
    private final ObjectMapper mapper;
    private final String baseUrl;
    private final String appCode;
    private final Map<String, CachedSnapshot> snapshots = new ConcurrentHashMap<>();
    private final Map<String, CachedProfile> profileDetails = new ConcurrentHashMap<>();
    private volatile long profileHydrationDisabledUntilMillis;

    @Autowired
    public EcpSelectableDirectoryService(EcpClient directoryClient,
                                         ObjectMapper mapper,
                                         @Value("${asset-portal.ecp-api-base-url}") String baseUrl,
                                         @Value("${ecp.sdk.app-code}") String appCode) {
        this.directoryClient = directoryClient;
        this.mapper = mapper;
        this.baseUrl = baseUrl.replaceAll("/$", "");
        this.appCode = appCode;
        this.httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();
    }

    EcpSelectableDirectoryService(ObjectMapper mapper, String baseUrl, String appCode) {
        this(null, mapper, baseUrl, appCode);
    }

    public EcpPage<EcpUserProfile> page(String query, int page, int size, String authorization) {
        String bearer = requireBearer(authorization);
        String normalizedQuery = text(query);
        if (normalizedQuery.isEmpty()) {
            List<EcpUserProfile> users = snapshot(bearer).users();
            int from = Math.min((page - 1) * size, users.size());
            int to = Math.min(from + size, users.size());
            return new EcpPage<>(List.copyOf(users.subList(from, to)), page, size, users.size());
        }

        UriComponentsBuilder uri = selectableAccountsUri()
            .queryParam("q", normalizedQuery)
            .queryParam("page", page - 1)
            .queryParam("pageSize", size);
        return hydratePage(parsePage(send(uri.build().encode().toUri(), bearer), page, size));
    }

    public DirectorySnapshot snapshot(String authorization) {
        String bearer = requireBearer(authorization);
        String cacheKey = digest(bearer);
        long now = System.currentTimeMillis();
        CachedSnapshot cached = snapshots.compute(cacheKey, (ignored, current) -> {
            if (current != null && current.expiresAtMillis() > now) return current;
            return new CachedSnapshot(loadSnapshot(bearer), System.currentTimeMillis() + CACHE_TTL_MILLIS);
        });
        return cached.snapshot();
    }

    public List<EcpUserProfile> exactNameMatches(Collection<String> names, String authorization) {
        Map<String, EcpUserProfile> matches = new LinkedHashMap<>();
        if (names == null) return List.of();
        for (String candidate : names) {
            String name = text(candidate);
            if (name.isEmpty()) continue;
            for (int pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber++) {
                EcpPage<EcpUserProfile> result = page(name, pageNumber, PAGE_SIZE, authorization);
                result.items().stream()
                    .filter(profile -> name.equals(text(profile.name())))
                    .forEach(profile -> matches.putIfAbsent(text(profile.unionId()), profile));
                if (!result.hasNext()) break;
            }
        }
        return List.copyOf(matches.values());
    }

    public List<EcpUserProfile> exactEmailMatches(Collection<String> emails, String authorization) {
        Map<String, EcpUserProfile> matches = new LinkedHashMap<>();
        if (emails == null) return List.of();
        for (String candidate : emails) {
            String email = text(candidate).toLowerCase(java.util.Locale.ROOT);
            if (email.isEmpty()) continue;
            for (int pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber++) {
                EcpPage<EcpUserProfile> result = page(email, pageNumber, PAGE_SIZE, authorization);
                result.items().stream()
                    .filter(profile -> email.equals(text(profile.email()).toLowerCase(java.util.Locale.ROOT)))
                    .forEach(profile -> matches.putIfAbsent(text(profile.unionId()), profile));
                if (!result.hasNext()) break;
            }
        }
        return List.copyOf(matches.values());
    }

    private DirectorySnapshot loadSnapshot(String bearer) {
        JsonNode departmentResponse = send(UriComponentsBuilder.fromUriString(baseUrl)
            .pathSegment("applications", appCode, "selectable-departments")
            .build().encode().toUri(), bearer);
        ParsedOrganization organization = parseOrganization(departmentResponse);

        List<DirectoryRoot> roots = new ArrayList<>(organization.roots());
        List<EcpCompanyProfile> companies = new ArrayList<>(organization.companies());
        if (roots.isEmpty()) {
            for (JsonNode node : loadAccountNodes(null, false, bearer)) {
                if (!organizationNode(node)) continue;
                DirectoryRoot root = DirectoryRoot.from(node);
                if (root.orgNodeUnionId().isEmpty()) continue;
                roots.add(root);
                companies.add(root.toCompany());
            }
        }

        Map<String, EcpDepartmentProfile> departmentsById = new LinkedHashMap<>();
        organization.departments().forEach(value -> departmentsById.put(text(value.unionId()), value));
        Map<String, EcpCompanyProfile> companiesById = new LinkedHashMap<>();
        companies.forEach(value -> companiesById.put(text(value.unionId()), value));
        Map<String, EcpUserProfile> users = new LinkedHashMap<>();
        for (DirectoryRoot root : roots) {
            List<JsonNode> nodes;
            try {
                nodes = loadAccountNodes(root, true, bearer);
            } catch (ResponseStatusException ignored) {
                nodes = List.of();
            }
            addProfiles(nodes, root, departmentsById, companiesById, users);
            if (usersForRoot(nodes).isEmpty()) {
                browseDirectAccounts(root, bearer, departmentsById, companiesById, users);
            }
        }

        List<EcpUserProfile> sortedUsers = users.values().stream()
            .sorted(Comparator.comparing(EcpUserProfile::name, String.CASE_INSENSITIVE_ORDER)
                .thenComparing(EcpUserProfile::unionId, String.CASE_INSENSITIVE_ORDER))
            .toList();
        return new DirectorySnapshot(
            distinctCompanies(companies),
            List.copyOf(organization.departments()),
            sortedUsers);
    }

    private void browseDirectAccounts(DirectoryRoot root, String bearer,
                                      Map<String, EcpDepartmentProfile> departmentsById,
                                      Map<String, EcpCompanyProfile> companiesById,
                                      Map<String, EcpUserProfile> users) {
        Deque<DirectoryRoot> pending = new ArrayDeque<>();
        Set<String> visited = new LinkedHashSet<>();
        pending.add(root);
        while (!pending.isEmpty() && visited.size() < MAX_ORGANIZATION_NODES) {
            DirectoryRoot current = pending.removeFirst();
            String key = current.accountSetUnionId() + ":" + current.orgNodeUnionId();
            if (!visited.add(key)) continue;
            List<JsonNode> nodes = loadAccountNodes(current, false, bearer);
            addProfiles(nodes, current, departmentsById, companiesById, users);
            for (JsonNode node : nodes) {
                if (!organizationNode(node)) continue;
                DirectoryRoot child = DirectoryRoot.from(node, root);
                if (!child.orgNodeUnionId().isEmpty()) pending.addLast(child);
            }
        }
    }

    private List<JsonNode> loadAccountNodes(DirectoryRoot root, boolean recursive, String bearer) {
        List<JsonNode> items = new ArrayList<>();
        for (int page = 0; page < MAX_PAGES; page++) {
            UriComponentsBuilder uri = selectableAccountsUri();
            if (root != null) {
                if (!root.accountSetUnionId().isEmpty()) {
                    uri.queryParam("parentAccountSetUnionId", root.accountSetUnionId());
                }
                if (!root.orgNodeUnionId().isEmpty()) {
                    uri.queryParam("parentOrgNodeUnionId", root.orgNodeUnionId());
                }
                uri.queryParam("recursive", recursive);
            }
            uri.queryParam("page", page).queryParam("pageSize", PAGE_SIZE);
            JsonNode response = send(uri.build().encode().toUri(), bearer);
            JsonNode nodes = responseNodes(response);
            if (!nodes.isArray()) break;
            nodes.forEach(items::add);
            long total = response.path("total").asLong(-1);
            if (nodes.size() < PAGE_SIZE || total >= 0 && items.size() >= total) break;
        }
        return items;
    }

    private void addProfiles(List<JsonNode> nodes, DirectoryRoot root,
                             Map<String, EcpDepartmentProfile> departmentsById,
                             Map<String, EcpCompanyProfile> companiesById,
                             Map<String, EcpUserProfile> users) {
        for (JsonNode node : nodes) {
            EcpUserProfile profile = profile(node);
            if (profile == null) continue;
            EcpUserProfile enriched = enrich(hydrate(profile), node, root, departmentsById, companiesById);
            users.putIfAbsent(enriched.unionId(), enriched);
        }
    }

    private EcpPage<EcpUserProfile> hydratePage(EcpPage<EcpUserProfile> page) {
        return new EcpPage<>(page.items().stream().map(this::hydrate).toList(),
            page.current(), page.size(), page.total());
    }

    private EcpUserProfile hydrate(EcpUserProfile profile) {
        if (directoryClient == null) return profile;
        String unionId = text(profile.unionId());
        if (unionId.isEmpty()) return profile;
        long now = System.currentTimeMillis();
        CachedProfile cached = profileDetails.get(unionId);
        if (cached != null && cached.expiresAtMillis() > now) return merge(cached.profile(), profile);
        if (profileHydrationDisabledUntilMillis > now) return profile;
        try {
            EcpUserProfile detail = directoryClient.directory().users().getByUnionId(unionId);
            EcpUserProfile merged = merge(detail, profile);
            profileDetails.put(unionId, new CachedProfile(merged, now + PROFILE_CACHE_TTL_MILLIS));
            return merged;
        } catch (RuntimeException error) {
            profileHydrationDisabledUntilMillis = now + PROFILE_HYDRATION_BACKOFF_MILLIS;
            return profile;
        }
    }

    private static EcpUserProfile merge(EcpUserProfile primary, EcpUserProfile fallback) {
        if (primary == null) return fallback;
        if (fallback == null) return primary;
        EcpUserProfile.CompanySummary company = primary.company() == null ? fallback.company() : primary.company();
        List<EcpUserProfile.DepartmentSummary> departments = primary.departments() == null || primary.departments().isEmpty()
            ? fallback.departments()
            : primary.departments();
        return new EcpUserProfile(
            first(primary.tenantId(), fallback.tenantId()),
            first(primary.unionId(), fallback.unionId()),
            first(primary.externalId(), fallback.externalId()),
            first(primary.accountSetUnionId(), fallback.accountSetUnionId()),
            first(primary.name(), fallback.name()),
            first(primary.email(), fallback.email()),
            first(primary.phone(), fallback.phone()),
            first(primary.status(), fallback.status()),
            first(primary.employeeNo(), fallback.employeeNo()),
            first(primary.jobTitle(), fallback.jobTitle()),
            first(primary.orgNodeUnionId(), fallback.orgNodeUnionId()),
            first(primary.orgNodeName(), fallback.orgNodeName()),
            first(primary.orgNodePath(), fallback.orgNodePath()),
            company,
            departments == null ? List.of() : departments);
    }

    private static List<EcpUserProfile> usersForRoot(List<JsonNode> nodes) {
        return nodes.stream().map(EcpSelectableDirectoryService::profile).filter(java.util.Objects::nonNull).toList();
    }

    private static EcpUserProfile enrich(EcpUserProfile profile, JsonNode node, DirectoryRoot root,
                                         Map<String, EcpDepartmentProfile> departmentsById,
                                         Map<String, EcpCompanyProfile> companiesById) {
        String orgNodeUnionId = first(node, "orgNodeUnionId", "orgNodeId", "departmentUnionId");
        EcpDepartmentProfile department = departmentsById.get(orgNodeUnionId);
        if (department == null) {
            department = resolveDepartment(profile, root, departmentsById.values());
            if (department != null) orgNodeUnionId = text(department.unionId());
        }
        EcpCompanyProfile companyProfile = department == null ? null : companiesById.get(text(department.companyUnionId()));
        if (companyProfile == null && root != null) companyProfile = companiesById.get(root.companyUnionId());

        EcpUserProfile.CompanySummary company = profile.company();
        if (companyProfile != null && (company == null || text(company.unionId()).isEmpty())) {
            company = new EcpUserProfile.CompanySummary(companyProfile.unionId(), companyProfile.externalId(),
                companyProfile.name(), companyProfile.accountSetUnionId());
        }

        List<EcpUserProfile.DepartmentSummary> departments = profile.departments();
        if (department != null) {
            EcpDepartmentProfile.LeaderSummary leader = department.leader();
            departments = List.of(new EcpUserProfile.DepartmentSummary(
                department.unionId(), department.externalId(), department.name(), department.nodeType(),
                department.path(), leader == null ? null : new EcpUserProfile.LeaderSummary(
                    leader.unionId(), leader.externalId(), leader.name())));
        } else if (root != null && orgNodeUnionId.equals(root.companyUnionId())) {
            departments = List.of();
        }
        String departmentName = department == null ? profile.orgNodeName() : department.name();
        String departmentPath = department == null ? profile.orgNodePath() : department.path();
        return new EcpUserProfile(
            profile.tenantId(), profile.unionId(), profile.externalId(), profile.accountSetUnionId(), profile.name(),
            profile.email(), profile.phone(), profile.status(), profile.employeeNo(), profile.jobTitle(),
            orgNodeUnionId, departmentName, departmentPath, company,
            departments == null ? List.of() : departments);
    }

    private static EcpDepartmentProfile resolveDepartment(EcpUserProfile profile, DirectoryRoot root,
                                                          java.util.Collection<EcpDepartmentProfile> departments) {
        String profilePath = normalizedPath(profile.orgNodePath());
        if (!profilePath.isEmpty()) {
            List<EcpDepartmentProfile> pathMatches = departments.stream()
                .filter(value -> root == null || root.companyUnionId().equals(text(value.companyUnionId())))
                .filter(value -> {
                    String departmentPath = normalizedPath(value.path());
                    return departmentPath.equals(profilePath)
                        || departmentPath.endsWith("/" + profilePath)
                        || profilePath.endsWith("/" + departmentPath);
                })
                .toList();
            if (pathMatches.size() == 1) return pathMatches.get(0);
        }
        String departmentName = text(profile.orgNodeName());
        if (departmentName.isEmpty()) return null;
        List<EcpDepartmentProfile> nameMatches = departments.stream()
            .filter(value -> departmentName.equals(text(value.name())))
            .filter(value -> root == null || root.companyUnionId().equals(text(value.companyUnionId())))
            .toList();
        return nameMatches.size() == 1 ? nameMatches.get(0) : null;
    }

    private static String normalizedPath(String value) {
        return java.util.Arrays.stream(text(value).split("/"))
            .map(String::trim)
            .filter(part -> !part.isEmpty())
            .collect(java.util.stream.Collectors.joining("/"));
    }

    static ParsedOrganization parseOrganization(JsonNode root) {
        List<EcpCompanyProfile> companies = new ArrayList<>();
        List<EcpDepartmentProfile> departments = new ArrayList<>();
        List<DirectoryRoot> roots = new ArrayList<>();
        JsonNode nodes = responseNodes(root);
        if (nodes.isArray()) {
            nodes.forEach(node -> {
                DirectoryRoot directoryRoot = DirectoryRoot.from(node);
                if (directoryRoot.orgNodeUnionId().isEmpty()) return;
                roots.add(directoryRoot);
                companies.add(directoryRoot.toCompany());
                appendDepartments(node.path("children"), directoryRoot.orgNodeUnionId(), directoryRoot,
                    departments);
            });
        }
        return new ParsedOrganization(List.copyOf(companies), List.copyOf(departments), List.copyOf(roots));
    }

    private static void appendDepartments(JsonNode children, String parentUnionId, DirectoryRoot root,
                                          List<EcpDepartmentProfile> departments) {
        if (!children.isArray()) return;
        children.forEach(node -> {
            String unionId = first(node, "orgNodeUnionId", "orgNodeId", "unionId");
            if (unionId.isEmpty()) return;
            String accountSetUnionId = first(first(node, "accountSetUnionId", "accountSetId"), root.accountSetUnionId());
            String name = first(first(node, "name", "label"), unionId);
            String path = first(first(node, "fullPath", "path"), name);
            departments.add(new EcpDepartmentProfile(
                "", unionId, first(node, "externalId"), accountSetUnionId, name,
                first(first(node, "nodeType"), "DEPARTMENT"), path, first(node, "status"),
                first(node, "sourceType"), parentUnionId, root.companyUnionId(), "", root.companyName(),
                leader(node)));
            appendDepartments(node.path("children"), unionId, root, departments);
        });
    }

    static EcpPage<EcpUserProfile> parsePage(JsonNode root, int page, int size) {
        JsonNode nodes = responseNodes(root);
        List<EcpUserProfile> profiles = new ArrayList<>();
        if (nodes.isArray()) {
            nodes.forEach(node -> {
                EcpUserProfile profile = profile(node);
                if (profile != null) profiles.add(profile);
            });
        }
        long total = root.path("total").canConvertToLong() ? root.path("total").asLong() : profiles.size();
        return new EcpPage<>(List.copyOf(profiles), page, size, total);
    }

    private JsonNode send(URI uri, String bearer) {
        HttpRequest request = HttpRequest.newBuilder(uri)
            .timeout(Duration.ofSeconds(20))
            .header("Authorization", bearer)
            .header("Accept", "application/json")
            .header("Accept-Encoding", "identity")
            .GET()
            .build();
        try {
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() == 401) {
                throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "ECP session is invalid");
            }
            if (response.statusCode() == 403) {
                throw new ResponseStatusException(HttpStatus.FORBIDDEN, "ECP permission denied");
            }
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "ECP directory request failed");
            }
            return mapper.readTree(response.body());
        } catch (ResponseStatusException error) {
            throw error;
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "ECP directory request interrupted", error);
        } catch (Exception error) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "ECP directory request failed", error);
        }
    }

    private UriComponentsBuilder selectableAccountsUri() {
        return UriComponentsBuilder.fromUriString(baseUrl)
            .pathSegment("applications", appCode, "selectable-accounts");
    }

    private static JsonNode responseNodes(JsonNode root) {
        if (root.path("nodes").isArray()) return root.path("nodes");
        if (root.path("items").isArray()) return root.path("items");
        JsonNode data = root.path("data");
        if (data.path("nodes").isArray()) return data.path("nodes");
        return data.path("items");
    }

    private static EcpUserProfile profile(JsonNode node) {
        String type = first(node, "nodeType", "subjectType", "accountType").toUpperCase(Locale.ROOT);
        if ("ORG".equals(type) || "DEPARTMENT".equals(type) || "DEPT".equals(type)) return null;

        String subject = first(node, "accountUnionId", "subjectAccountId", "accountId", "unionId");
        if (subject.isEmpty()) subject = accountSubject(first(node, "subject", "subjectKey"));
        String name = first(node, "name", "subjectLabel", "displayName");
        if (subject.isEmpty() || name.isEmpty()) return null;

        String path = first(node, "path", "departmentPath", "fullPath");
        List<String> pathParts = pathParts(path, name);
        String accountSetUnionId = first(node, "accountSetUnionId", "accountSetId");
        String companyName = first(node, "companyName");
        if (companyName.isEmpty() && !pathParts.isEmpty()) {
            int companyIndex = !accountSetUnionId.isEmpty() && pathParts.size() > 1 ? 1 : 0;
            companyName = pathParts.get(companyIndex);
        }
        String departmentName = first(node, "departmentName", "primaryDepartmentName");
        if (departmentName.isEmpty() && pathParts.size() > 1) departmentName = pathParts.get(pathParts.size() - 1);

        String companyUnionId = first(node, "companyUnionId", "companyId");
        EcpUserProfile.CompanySummary company = companyName.isEmpty() && companyUnionId.isEmpty() ? null
            : new EcpUserProfile.CompanySummary(companyUnionId, "", companyName, accountSetUnionId);

        String departmentUnionId = first(node, "departmentUnionId", "primaryDepartmentUnionId", "orgNodeUnionId", "orgNodeId");
        EcpUserProfile.DepartmentSummary department = departmentName.isEmpty() && departmentUnionId.isEmpty() ? null
            : new EcpUserProfile.DepartmentSummary(departmentUnionId, "", departmentName, "DEPARTMENT", path,
                userDepartmentLeader(node));
        List<EcpUserProfile.DepartmentSummary> departments = department == null ? List.of() : List.of(department);

        return new EcpUserProfile(
            first(node, "tenantId"), subject, first(node, "externalId"), accountSetUnionId, name,
            first(node, "email"), first(node, "phone"), first(node, "status"), employeeNo(node),
            jobTitle(node), departmentUnionId, departmentName, path, company, departments);
    }

    private static String employeeNo(JsonNode node) {
        return first(node,
            "employeeNo", "employeeNumber", "employeeCode", "staffNo", "staffNumber",
            "jobNumber", "workNo", "employee_no", "employee_number", "employee_code",
            "staff_no", "staff_number", "job_number", "work_no");
    }

    private static String jobTitle(JsonNode node) {
        return first(node,
            "jobTitle", "positionName", "position", "postName", "post", "title",
            "job_title", "position_name", "post_name");
    }

    private static EcpDepartmentProfile.LeaderSummary leader(JsonNode node) {
        String name = first(node,
            "leaderName", "departmentLeaderName", "managerName", "ownerName",
            "responsibleName", "principalName");
        JsonNode leader = firstObject(node, "leader", "departmentLeader", "manager", "owner", "responsible", "principal");
        if (name.isEmpty() && leader != null) name = first(leader, "name", "subjectLabel", "displayName");
        if (name.isEmpty()) return null;
        return new EcpDepartmentProfile.LeaderSummary(
            leader == null ? "" : first(leader, "unionId", "accountUnionId", "subjectAccountId", "accountId"),
            leader == null ? "" : first(leader, "externalId"),
            name);
    }

    private static EcpUserProfile.LeaderSummary userDepartmentLeader(JsonNode node) {
        EcpDepartmentProfile.LeaderSummary leader = leader(node);
        return leader == null ? null : new EcpUserProfile.LeaderSummary(
            leader.unionId(), leader.externalId(), leader.name());
    }

    private static List<String> pathParts(String path, String name) {
        List<String> parts = new ArrayList<>(java.util.Arrays.stream(text(path).split("/"))
            .map(String::trim)
            .filter(value -> !value.isEmpty())
            .toList());
        if (!parts.isEmpty() && name.equals(parts.get(parts.size() - 1))) parts.remove(parts.size() - 1);
        return parts;
    }

    private static String accountSubject(String value) {
        String normalized = text(value);
        if (normalized.regionMatches(true, 0, "account:", 0, "account:".length())) {
            return normalized.substring("account:".length()).trim();
        }
        return normalized;
    }

    private static boolean organizationNode(JsonNode node) {
        String type = first(node, "nodeType", "subjectType", "accountType").toUpperCase(Locale.ROOT);
        return "ORG".equals(type) || "DEPARTMENT".equals(type) || "DEPT".equals(type);
    }

    private static List<EcpCompanyProfile> distinctCompanies(List<EcpCompanyProfile> companies) {
        Map<String, EcpCompanyProfile> values = new LinkedHashMap<>();
        companies.forEach(value -> values.putIfAbsent(text(value.unionId()), value));
        values.remove("");
        return List.copyOf(values.values());
    }

    private static String requireBearer(String authorization) {
        String bearer = text(authorization);
        if (!bearer.startsWith("Bearer ")) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "ECP session is required");
        }
        return bearer;
    }

    private static String digest(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception error) {
            throw new IllegalStateException("SHA-256 is unavailable", error);
        }
    }

    private static String first(JsonNode node, String... fields) {
        for (String field : fields) {
            String value = text(node.path(field).asText(""));
            if (!value.isEmpty() && !"null".equalsIgnoreCase(value)) return value;
        }
        return "";
    }

    private static JsonNode firstObject(JsonNode node, String... fields) {
        for (String field : fields) {
            JsonNode value = node.path(field);
            if (value.isObject()) return value;
        }
        return null;
    }

    private static String first(String... values) {
        for (String value : values) {
            String normalized = text(value);
            if (!normalized.isEmpty()) return normalized;
        }
        return "";
    }

    private static String text(String value) {
        return value == null ? "" : value.trim();
    }

    public record DirectorySnapshot(List<EcpCompanyProfile> companies,
                                    List<EcpDepartmentProfile> departments,
                                    List<EcpUserProfile> users) {}

    static record ParsedOrganization(List<EcpCompanyProfile> companies,
                                     List<EcpDepartmentProfile> departments,
                                     List<DirectoryRoot> roots) {}

    private record CachedSnapshot(DirectorySnapshot snapshot, long expiresAtMillis) {}

    private record CachedProfile(EcpUserProfile profile, long expiresAtMillis) {}

    static record DirectoryRoot(String accountSetUnionId, String orgNodeUnionId,
                                String companyUnionId, String companyName, String path) {
        static DirectoryRoot from(JsonNode node) {
            String orgNodeUnionId = first(node, "orgNodeUnionId", "orgNodeId", "unionId");
            String name = first(first(node, "name", "label"), orgNodeUnionId);
            return new DirectoryRoot(first(node, "accountSetUnionId", "accountSetId"), orgNodeUnionId,
                orgNodeUnionId, name, first(first(node, "fullPath", "path"), name));
        }

        static DirectoryRoot from(JsonNode node, DirectoryRoot company) {
            return new DirectoryRoot(
                first(first(node, "accountSetUnionId", "accountSetId"), company.accountSetUnionId()),
                first(node, "orgNodeUnionId", "orgNodeId", "unionId"), company.companyUnionId(),
                company.companyName(), first(first(node, "fullPath", "path"), company.path()));
        }

        EcpCompanyProfile toCompany() {
            return new EcpCompanyProfile("", companyUnionId, "", accountSetUnionId, companyName,
                "", "", orgNodeUnionId);
        }
    }
}
