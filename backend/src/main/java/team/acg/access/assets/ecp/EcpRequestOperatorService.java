package team.acg.access.assets.ecp;

import com.idanchuang.ecp.api.common.model.role.ApplicationRole;
import com.idanchuang.ecp.api.common.model.role.ApplicationRoleAssignment;
import com.idanchuang.ecp.sdk.client.EcpClient;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

@Service
@ConditionalOnProperty(prefix = "ecp.sdk", name = "enabled", havingValue = "true")
public class EcpRequestOperatorService {
    private static final String REVIEW_PERMISSION = "asset:request:review";
    private final EcpClient client;

    public EcpRequestOperatorService(EcpClient client) {
        this.client = client;
    }

    public List<RequestOperator> list() {
        List<ApplicationRole> roles = client.roles().list().stream()
            .filter(EcpRequestOperatorService::canReviewRequests)
            .toList();
        Map<String, RequestOperator> operators = new LinkedHashMap<>();
        for (ApplicationRole role : roles) {
            for (ApplicationRoleAssignment assignment : client.roles().assignments().list(null, role.id())) {
                if (!"ACCOUNT".equalsIgnoreCase(text(assignment.subjectType()))) continue;
                String subject = subject(assignment);
                String name = text(assignment.subjectLabel());
                if (subject.isBlank() || name.isBlank()) continue;
                operators.putIfAbsent(subject.toLowerCase(Locale.ROOT), new RequestOperator(
                    subject, name, text(assignment.companyName()), text(assignment.departmentName())));
            }
        }
        return List.copyOf(operators.values());
    }

    private static boolean canReviewRequests(ApplicationRole role) {
        if (role == null || role.id() == null || "disabled".equalsIgnoreCase(text(role.status()))) return false;
        if (role.effectivePermissionCodes() != null && role.effectivePermissionCodes().contains(REVIEW_PERMISSION)) return true;
        String code = text(role.code()).toUpperCase(Locale.ROOT);
        String type = text(role.roleTypeCode()).toUpperCase(Locale.ROOT);
        return "APP_ADMIN".equals(code) || "APP_ADMIN".equals(type) || "OPERATOR".equals(code) || "OPERATOR".equals(type);
    }

    private static String subject(ApplicationRoleAssignment assignment) {
        String value = text(assignment.subjectKey());
        return value.regionMatches(true, 0, "account:", 0, 8) ? value.substring(8).trim() : value;
    }

    private static String text(Object value) {
        return value == null ? "" : value.toString().trim();
    }

    public record RequestOperator(String subject, String name, String company, String department) {}
}
