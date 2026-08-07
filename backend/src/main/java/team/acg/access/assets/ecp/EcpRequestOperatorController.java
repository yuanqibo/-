package team.acg.access.assets.ecp;

import com.idanchuang.ecp.sdk.spring.annotation.RequirePermission;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/ecp/request-operators")
@ConditionalOnProperty(prefix = "ecp.sdk", name = "enabled", havingValue = "true")
public class EcpRequestOperatorController {
    private final EcpRequestOperatorService operators;

    public EcpRequestOperatorController(EcpRequestOperatorService operators) {
        this.operators = operators;
    }

    @GetMapping
    @RequirePermission(permissions = "asset:request:create")
    public OperatorResponse list(HttpServletRequest request) {
        return new OperatorResponse(operators.list(request));
    }

    public record OperatorResponse(List<EcpRequestOperatorService.RequestOperator> items) {}
}
