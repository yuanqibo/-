package team.acg.access.assets.ecp;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.MediaType;
import org.springframework.http.HttpStatusCode;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.server.ResponseStatusException;
import team.acg.access.assets.auth.RequestIdentityService;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Map;

@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
public class BusinessApiFailClosedFilter extends OncePerRequestFilter {
    private final EcpSecurityPolicy securityPolicy;
    private final RequestIdentityService identityService;
    private final ObjectMapper mapper;

    public BusinessApiFailClosedFilter(EcpSecurityPolicy securityPolicy, RequestIdentityService identityService,
                                       ObjectMapper mapper) {
        this.securityPolicy = securityPolicy;
        this.identityService = identityService;
        this.mapper = mapper;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String path = request.getRequestURI();
        boolean apiPath = path.equals("/api") || path.startsWith("/api/");
        boolean ecpProxyPath = path.equals("/api/v1") || path.startsWith("/api/v1/");
        return !apiPath || ecpProxyPath;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
        throws ServletException, IOException {
        if (securityPolicy.enabled() || securityPolicy.testBypassEnabled()) {
            try {
                identityService.current(request);
            } catch (ResponseStatusException error) {
                writeError(response, error.getStatusCode(),
                    error.getReason() == null ? "ECP authorization failed" : error.getReason());
                return;
            }
            filterChain.doFilter(request, response);
            return;
        }
        writeError(response, HttpStatusCode.valueOf(HttpServletResponse.SC_SERVICE_UNAVAILABLE),
            "ECP server authorization is disabled");
    }

    private void writeError(HttpServletResponse response, HttpStatusCode status, String message) throws IOException {
        response.setStatus(status.value());
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        mapper.writeValue(response.getWriter(), Map.of("error", message));
    }
}
