package team.acg.access.assets.ecp;

import com.idanchuang.ecp.api.common.model.directory.EcpUserProfile;
import com.idanchuang.ecp.sdk.client.EcpClient;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

@Service
@ConditionalOnProperty(prefix = "ecp.sdk", name = "enabled", havingValue = "true")
public class EcpDirectoryUserService {
    private final EcpClient client;

    public EcpDirectoryUserService(EcpClient client) {
        this.client = client;
    }

    public DirectoryParty requireBySubject(String subject) {
        String normalized = text(subject);
        if (normalized.isEmpty() || normalized.length() > 191 || normalized.chars().anyMatch(value -> value < 0x20)) {
            throw new IllegalArgumentException("A valid ECP directory user subject is required");
        }
        EcpUserProfile profile = client.directory().users().getByUnionId(normalized);
        if (profile == null || !normalized.equals(text(profile.unionId()))) {
            throw new IllegalArgumentException("ECP directory user does not match the supplied subject");
        }
        String name = text(profile.name());
        if (name.isEmpty()) throw new IllegalArgumentException("ECP directory user has no display name");

        EcpUserProfile.DepartmentSummary department = profile.departments() == null || profile.departments().isEmpty()
            ? null : profile.departments().get(0);
        EcpUserProfile.CompanySummary company = profile.company();
        return new DirectoryParty(normalized, name,
            department == null ? "" : text(department.unionId()),
            department == null ? "" : text(department.name()),
            company == null ? "" : text(company.unionId()),
            company == null ? "" : text(company.name()));
    }

    private static String text(String value) {
        return value == null ? "" : value.trim();
    }

    public record DirectoryParty(String subject, String name, String departmentUnionId, String department,
                                 String companyUnionId, String company) {}
}
