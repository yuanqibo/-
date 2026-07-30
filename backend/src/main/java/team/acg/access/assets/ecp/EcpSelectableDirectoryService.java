package team.acg.access.assets.ecp;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.idanchuang.ecp.api.common.model.directory.EcpUserProfile;
import com.idanchuang.ecp.sdk.client.model.EcpPage;
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
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

@Service
@ConditionalOnProperty(prefix = "ecp.sdk", name = "enabled", havingValue = "true")
public class EcpSelectableDirectoryService {
    private final HttpClient client;
    private final ObjectMapper mapper;
    private final String baseUrl;
    private final String appCode;

    public EcpSelectableDirectoryService(ObjectMapper mapper,
                                         @Value("${asset-portal.ecp-api-base-url}") String baseUrl,
                                         @Value("${ecp.sdk.app-code}") String appCode) {
        this.mapper = mapper;
        this.baseUrl = baseUrl.replaceAll("/$", "");
        this.appCode = appCode;
        this.client = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();
    }

    public EcpPage<EcpUserProfile> page(String query, int page, int size, String authorization) {
        String bearer = text(authorization);
        if (!bearer.startsWith("Bearer ")) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "ECP session is required");
        }

        URI uri = UriComponentsBuilder.fromUriString(baseUrl)
            .pathSegment("applications", appCode, "selectable-accounts")
            .queryParam("q", text(query))
            .queryParam("page", page - 1)
            .queryParam("pageSize", size)
            .build()
            .encode()
            .toUri();
        HttpRequest request = HttpRequest.newBuilder(uri)
            .timeout(Duration.ofSeconds(20))
            .header("Authorization", bearer)
            .header("Accept", "application/json")
            .header("Accept-Encoding", "identity")
            .GET()
            .build();

        try {
            HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() == 401) {
                throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "ECP session is invalid");
            }
            if (response.statusCode() == 403) {
                throw new ResponseStatusException(HttpStatus.FORBIDDEN, "ECP permission denied");
            }
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "ECP directory request failed");
            }
            return parsePage(mapper.readTree(response.body()), page, size);
        } catch (ResponseStatusException error) {
            throw error;
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "ECP directory request interrupted", error);
        } catch (Exception error) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "ECP directory request failed", error);
        }
    }

    static EcpPage<EcpUserProfile> parsePage(JsonNode root, int page, int size) {
        JsonNode nodes = root.path("nodes");
        if (!nodes.isArray()) nodes = root.path("items");
        if (!nodes.isArray()) nodes = mapperNode(root.path("data"));

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

    private static JsonNode mapperNode(JsonNode data) {
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
            : new EcpUserProfile.DepartmentSummary(departmentUnionId, "", departmentName, "DEPARTMENT", path, null);
        List<EcpUserProfile.DepartmentSummary> departments = department == null ? List.of() : List.of(department);

        return new EcpUserProfile(
            first(node, "tenantId"), subject, first(node, "externalId"), accountSetUnionId, name,
            first(node, "email"), first(node, "phone"), first(node, "status"), first(node, "employeeNo"),
            first(node, "jobTitle"), departmentUnionId, departmentName, path, company, departments);
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

    private static String first(JsonNode node, String... fields) {
        for (String field : fields) {
            String value = text(node.path(field).asText(""));
            if (!value.isEmpty() && !"null".equalsIgnoreCase(value)) return value;
        }
        return "";
    }

    private static String text(String value) {
        return value == null ? "" : value.trim();
    }
}
