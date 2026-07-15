package team.acg.access.assets.ecp;

import com.idanchuang.ecp.sdk.spring.annotation.RequirePermission;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpHeaders;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import team.acg.access.assets.auth.RequestIdentityService;

@RestController
@RequestMapping("/api/ecp/organization")
@ConditionalOnProperty(prefix = "ecp.sdk", name = "enabled", havingValue = "true")
public class EcpOrganizationController {
    private final EcpOrganizationService organizationService;
    private final RequestIdentityService identityService;

    public EcpOrganizationController(EcpOrganizationService organizationService, RequestIdentityService identityService) {
        this.organizationService = organizationService;
        this.identityService = identityService;
    }

    @GetMapping
    @RequirePermission(permissions = "asset:department:view")
    public EcpOrganizationService.OrganizationConsole organization(HttpServletRequest request) {
        RequestIdentityService.Identity identity = identityService.current(request).orElseThrow();
        return organizationService.load(identity.tenantId(), request.getHeader(HttpHeaders.AUTHORIZATION));
    }
}
