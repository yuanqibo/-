package team.acg.access.assets.approval;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class ApprovalIntegrationProperties {
    private final boolean enabled;
    private final String templateCode;
    private final String mainTableCode;
    private final String callbackUrl;
    private final String publicBaseUrl;

    public ApprovalIntegrationProperties(
        @Value("${asset-portal.approval.enabled:false}") boolean enabled,
        @Value("${asset-portal.approval.template-code:}") String templateCode,
        @Value("${asset-portal.approval.main-table-code:MAIN}") String mainTableCode,
        @Value("${asset-portal.approval.callback-url:}") String callbackUrl,
        @Value("${asset-portal.public-base-url}") String publicBaseUrl
    ) {
        this.enabled = enabled;
        this.templateCode = text(templateCode);
        this.mainTableCode = text(mainTableCode);
        this.callbackUrl = text(callbackUrl);
        this.publicBaseUrl = stripTrailingSlash(publicBaseUrl);
    }

    public boolean enabled() {
        return enabled;
    }

    public String templateCode() {
        return required(templateCode, "APPROVAL_TEMPLATE_CODE is required when approval integration is enabled");
    }

    public String mainTableCode() {
        return required(mainTableCode, "Approval main table code is required");
    }

    public String callbackUrl() {
        String configured = callbackUrl.isEmpty()
            ? publicBaseUrl + "/api/ecp/approval/callback"
            : callbackUrl;
        if (!configured.startsWith("https://") && !configured.startsWith("http://")) {
            throw new IllegalStateException("Approval callback URL must be an absolute HTTP(S) URL");
        }
        return configured;
    }

    public String detailUrl(String bizNo) {
        return publicBaseUrl + "/?approvalRequest=" + java.net.URLEncoder.encode(
            bizNo, java.nio.charset.StandardCharsets.UTF_8);
    }

    private static String required(String value, String message) {
        if (value == null || value.isBlank()) throw new IllegalStateException(message);
        return value;
    }

    private static String stripTrailingSlash(String value) {
        String normalized = text(value);
        while (normalized.endsWith("/")) normalized = normalized.substring(0, normalized.length() - 1);
        return normalized;
    }

    private static String text(String value) {
        return value == null ? "" : value.trim();
    }
}
