package team.acg.access.assets.auth;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.util.UriComponentsBuilder;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Arrays;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/auth")
public class FeishuAuthController {
    private final ObjectMapper mapper;
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
    private final String appId;
    private final String appSecret;
    private final String publicBaseUrl;
    private final Set<String> adminAccounts;

    public FeishuAuthController(ObjectMapper mapper,
                                @Value("${asset-portal.feishu.app-id}") String appId,
                                @Value("${asset-portal.feishu.app-secret}") String appSecret,
                                @Value("${asset-portal.public-base-url}") String publicBaseUrl,
                                @Value("${asset-portal.admin-accounts}") String adminAccounts) {
        this.mapper = mapper;
        this.appId = appId;
        this.appSecret = appSecret;
        this.publicBaseUrl = publicBaseUrl.replaceAll("/$", "");
        this.adminAccounts = Arrays.stream(adminAccounts.split(","))
            .map(String::trim).map(String::toLowerCase).filter(value -> !value.isBlank()).collect(Collectors.toSet());
    }

    @GetMapping("/feishu/login")
    public Map<String, String> login(HttpSession session) {
        requireConfiguration();
        String state = UUID.randomUUID().toString();
        session.setAttribute("feishu_oauth_state", state);
        String redirectUri = redirectUri();
        String authorizationUrl = UriComponentsBuilder.fromUriString("https://accounts.feishu.cn/open-apis/authen/v1/authorize")
            .queryParam("app_id", appId).queryParam("redirect_uri", redirectUri).queryParam("state", state)
            .build().encode().toUriString();
        return Map.of("authorizationUrl", authorizationUrl, "redirectUri", redirectUri);
    }

    @GetMapping("/feishu/callback")
    public ResponseEntity<Void> callback(@RequestParam String code, @RequestParam String state, HttpSession session) throws Exception {
        Object expectedState = session.getAttribute("feishu_oauth_state");
        session.removeAttribute("feishu_oauth_state");
        if (expectedState == null || !expectedState.equals(state)) {
            return ResponseEntity.status(302).location(URI.create("/?auth=feishu_failed")).build();
        }
        JsonNode token = postJson("https://open.feishu.cn/open-apis/authen/v2/oauth/token", Map.of(
            "grant_type", "authorization_code", "client_id", appId, "client_secret", appSecret,
            "code", code, "redirect_uri", redirectUri()));
        String accessToken = token.path("access_token").asText(token.path("user_access_token").asText());
        JsonNode rawUser = getJson("https://open.feishu.cn/open-apis/authen/v1/user_info", accessToken);
        session.setAttribute("user", normalizeUser(rawUser));
        return ResponseEntity.status(302).location(URI.create("/")).build();
    }

    @GetMapping("/me")
    public Map<String, Object> me(HttpSession session) {
        Object user = session.getAttribute("user");
        return user == null ? Map.of("authenticated", false) : Map.of("authenticated", true, "user", user);
    }

    @PostMapping("/logout")
    public Map<String, Boolean> logout(HttpServletRequest request) {
        HttpSession session = request.getSession(false);
        if (session != null) session.invalidate();
        return Map.of("ok", true);
    }

    private Map<String, String> normalizeUser(JsonNode user) {
        String email = text(user, "email", text(user, "enterprise_email", ""));
        String subject = text(user, "union_id", text(user, "open_id", text(user, "user_id", email)));
        String account = email.isBlank() ? subject : email.split("@")[0];
        boolean admin = adminAccounts.contains(email.toLowerCase()) || adminAccounts.contains(account.toLowerCase());
        return Map.of(
            "name", text(user, "name", account), "account", account, "email", email,
            "phone", text(user, "mobile", ""), "department", "飞书组织",
            "roleCode", admin ? "admin" : "employee", "roleName", admin ? "普通管理员" : "普通员工",
            "scope", admin ? "资产与系统管理" : "本人资产、个人申请和审批状态",
            "externalSubject", "feishu:" + subject);
    }

    private JsonNode postJson(String url, Object body) throws Exception {
        HttpRequest request = HttpRequest.newBuilder(URI.create(url)).header("content-type", MediaType.APPLICATION_JSON_VALUE)
            .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body))).build();
        return responseData(client.send(request, HttpResponse.BodyHandlers.ofString()));
    }

    private JsonNode getJson(String url, String token) throws Exception {
        HttpRequest request = HttpRequest.newBuilder(URI.create(url)).header("authorization", "Bearer " + token).GET().build();
        return responseData(client.send(request, HttpResponse.BodyHandlers.ofString()));
    }

    private JsonNode responseData(HttpResponse<String> response) throws Exception {
        JsonNode body = mapper.readTree(response.body());
        if (response.statusCode() >= 400 || body.path("code").asInt() != 0) {
            throw new IllegalStateException("Feishu API request failed");
        }
        return body.path("data");
    }

    private String text(JsonNode node, String key, String fallback) {
        String value = node.path(key).asText("").trim();
        return value.isBlank() ? fallback : value;
    }

    private String redirectUri() {
        return publicBaseUrl + "/api/auth/feishu/callback";
    }

    private void requireConfiguration() {
        if (appId.isBlank() || appSecret.isBlank()) throw new IllegalStateException("Feishu OAuth is not configured");
    }
}
