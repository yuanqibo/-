package team.acg.access.assets.web;

import com.idanchuang.ecp.sdk.client.exception.EcpAuthenticationException;
import com.idanchuang.ecp.sdk.client.exception.EcpPermissionDeniedException;
import com.idanchuang.ecp.sdk.client.exception.EcpRemoteException;
import team.acg.access.assets.asset.AssetVersionConflictException;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.servlet.resource.NoResourceFoundException;
import org.springframework.web.server.ResponseStatusException;

import java.util.Map;
import java.util.LinkedHashMap;

@RestControllerAdvice
public class ApiExceptionHandler {
    private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);

    @ExceptionHandler(IllegalArgumentException.class)
    ResponseEntity<?> badRequest(IllegalArgumentException error) {
        return ResponseEntity.badRequest().body(Map.of("error", error.getMessage()));
    }

    @ExceptionHandler(AssetVersionConflictException.class)
    ResponseEntity<?> assetVersionConflict(AssetVersionConflictException error) {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("error", error.getMessage()));
    }

    @ExceptionHandler(NoResourceFoundException.class)
    ResponseEntity<?> notFound(NoResourceFoundException error) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "Not found"));
    }

    @ExceptionHandler(ResponseStatusException.class)
    ResponseEntity<?> status(ResponseStatusException error) {
        return ResponseEntity.status(error.getStatusCode()).body(Map.of("error", error.getReason() == null ? "Request failed" : error.getReason()));
    }

    @ExceptionHandler(EcpAuthenticationException.class)
    ResponseEntity<?> ecpAuthentication(EcpAuthenticationException error) {
        return ecpError(HttpStatus.UNAUTHORIZED, "ECP authentication failed", error);
    }

    @ExceptionHandler(EcpPermissionDeniedException.class)
    ResponseEntity<?> ecpPermissionDenied(EcpPermissionDeniedException error) {
        Map<String, Object> body = ecpErrorBody("ECP permission denied", error);
        body.put("requiredPermissionCodes", error.getRequiredPermissionCodes());
        body.put("matchedPermissionCodes", error.getMatchedPermissionCodes());
        body.put("reasonCode", text(error.getReasonCode()));
        return ResponseEntity.status(HttpStatus.FORBIDDEN).body(body);
    }

    @ExceptionHandler(EcpRemoteException.class)
    ResponseEntity<?> ecpRemote(EcpRemoteException error) {
        HttpStatus status = HttpStatus.resolve(error.getStatusCode());
        if (status == null || status.is5xxServerError()) status = HttpStatus.BAD_GATEWAY;
        return ecpError(status, "ECP request failed", error);
    }

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    ResponseEntity<?> methodNotAllowed(HttpRequestMethodNotSupportedException error) {
        return ResponseEntity.status(HttpStatus.METHOD_NOT_ALLOWED).body(Map.of("error", "Method not allowed"));
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<?> internalError(Exception error, HttpServletRequest request) {
        log.error("Request failed: {} {}", request.getMethod(), request.getRequestURI(), error);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of("error", "Internal Server Error"));
    }

    private ResponseEntity<?> ecpError(HttpStatus status, String message, EcpRemoteException error) {
        return ResponseEntity.status(status).body(ecpErrorBody(message, error));
    }

    private Map<String, Object> ecpErrorBody(String message, EcpRemoteException error) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("error", message);
        body.put("errorCode", text(error.getErrorCode()));
        body.put("requestId", text(error.getRequestId()));
        return body;
    }

    private String text(String value) {
        return value == null ? "" : value;
    }
}
