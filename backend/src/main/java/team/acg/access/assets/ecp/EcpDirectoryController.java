package team.acg.access.assets.ecp;

import com.idanchuang.ecp.api.common.model.directory.EcpUserProfile;
import com.idanchuang.ecp.sdk.client.exception.EcpPermissionDeniedException;
import com.idanchuang.ecp.sdk.client.model.EcpPage;
import com.idanchuang.ecp.sdk.spring.annotation.PermissionSpec;
import com.idanchuang.ecp.sdk.spring.annotation.RequireAnyPermission;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpHeaders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/ecp/directory")
@ConditionalOnProperty(prefix = "ecp.sdk", name = "enabled", havingValue = "true")
public class EcpDirectoryController {
    private final EcpDirectoryUserService directoryUsers;
    private final EcpSelectableDirectoryService selectableDirectory;

    public EcpDirectoryController(EcpDirectoryUserService directoryUsers,
                                  EcpSelectableDirectoryService selectableDirectory) {
        this.directoryUsers = directoryUsers;
        this.selectableDirectory = selectableDirectory;
    }

    @GetMapping("/users")
    @RequireAnyPermission({
        @PermissionSpec("asset:employee:view"),
        @PermissionSpec("asset:department:view"),
        @PermissionSpec("asset:item:create"),
        @PermissionSpec("asset:item:receive"),
        @PermissionSpec("asset:item:borrow"),
        @PermissionSpec("asset:item:handover"),
        @PermissionSpec("asset:item:update"),
        @PermissionSpec("asset:item:batchUpdate"),
        @PermissionSpec("asset:receive_return:receive"),
        @PermissionSpec("asset:receive_return:handover"),
        @PermissionSpec("asset:borrow_return:borrow"),
        @PermissionSpec("asset:request:create"),
        @PermissionSpec("asset:request:review")
    })
    public DirectoryUserPage users(@RequestParam(defaultValue = "") String query,
                                   @RequestParam(defaultValue = "1") int page,
                                   @RequestParam(defaultValue = "50") int size,
                                   HttpServletRequest request) {
        String normalizedQuery = query == null ? "" : query.trim();
        if (normalizedQuery.length() > 100) throw new IllegalArgumentException("Directory query is too long");
        if (page < 1) throw new IllegalArgumentException("Directory page must be positive");
        if (size < 1 || size > 100) throw new IllegalArgumentException("Directory page size must be between 1 and 100");

        EcpPage<EcpUserProfile> result;
        try {
            result = directoryUsers.page(normalizedQuery, page, size);
            if (result.items().isEmpty()) {
                result = selectableDirectory.page(normalizedQuery, page, size,
                    request.getHeader(HttpHeaders.AUTHORIZATION));
                directoryUsers.rememberAll(result.items());
            }
        } catch (EcpPermissionDeniedException ignored) {
            result = selectableDirectory.page(normalizedQuery, page, size,
                request.getHeader(HttpHeaders.AUTHORIZATION));
            directoryUsers.rememberAll(result.items());
        }
        return new DirectoryUserPage(
            result.items().stream().map(DirectoryUser::from).toList(),
            result.current(), result.size(), result.total(), result.totalPages(), result.hasNext());
    }

    public record DirectoryUserPage(List<DirectoryUser> items, long current, long size, long total,
                                    long totalPages, boolean hasNext) {}

    public record DirectoryUser(String subject, String unionId, String externalId, String accountSetUnionId,
                                String name, String displayName, String email, String phone, String employeeNo,
                                String jobTitle, String status, Company company, List<Department> departments) {
        static DirectoryUser from(EcpUserProfile profile) {
            Company company = profile.company() == null ? null : new Company(
                profile.company().unionId(), profile.company().externalId(), profile.company().name(),
                profile.company().accountSetUnionId());
            List<Department> departments = profile.departments() == null ? List.of() : profile.departments().stream()
                .map(value -> new Department(value.unionId(), value.externalId(), value.name(), value.path()))
                .toList();
            String subject = first(profile.unionId(), profile.externalId());
            return new DirectoryUser(subject, profile.unionId(), profile.externalId(), profile.accountSetUnionId(),
                profile.name(), profile.name(), profile.email(), profile.phone(), profile.employeeNo(), profile.jobTitle(),
                profile.status(), company, departments);
        }

        private static String first(String... values) {
            return java.util.Arrays.stream(values).filter(java.util.Objects::nonNull)
                .map(String::trim).filter(value -> !value.isEmpty()).findFirst().orElse("");
        }
    }

    public record Company(String unionId, String externalId, String name, String accountSetUnionId) {}
    public record Department(String unionId, String externalId, String name, String path) {}
}
