package team.acg.access.assets.sync;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;
import java.time.Instant;

@ConfigurationProperties(prefix = "asset-portal.legacy-asset-sync")
public class LegacyAssetSyncProperties {
    private boolean enabled;
    private boolean readOnly = true;
    private String baseUrl = "https://ams.bearrental.com";
    private String appId = "";
    private String appSecret = "";
    private String username = "";
    private String cron = "0 0/30 * * * *";
    private String zone = "Asia/Shanghai";
    private Duration requestTimeout = Duration.ofSeconds(15);
    private Duration requestInterval = Duration.ofMillis(250);
    private Duration safetyDelay = Duration.ofMinutes(5);
    private Duration overlap = Duration.ofMinutes(10);
    private boolean bootstrapEnabled;
    private int pageSize = 100;
    private Instant initialCursor;

    public boolean isEnabled() { return enabled; }
    public void setEnabled(boolean enabled) { this.enabled = enabled; }
    public boolean isReadOnly() { return readOnly; }
    public void setReadOnly(boolean readOnly) { this.readOnly = readOnly; }
    public String getBaseUrl() { return baseUrl; }
    public void setBaseUrl(String baseUrl) { this.baseUrl = baseUrl; }
    public String getAppId() { return appId; }
    public void setAppId(String appId) { this.appId = appId; }
    public String getAppSecret() { return appSecret; }
    public void setAppSecret(String appSecret) { this.appSecret = appSecret; }
    public String getUsername() { return username; }
    public void setUsername(String username) { this.username = username; }
    public String getCron() { return cron; }
    public void setCron(String cron) { this.cron = cron; }
    public String getZone() { return zone; }
    public void setZone(String zone) { this.zone = zone; }
    public Duration getRequestTimeout() { return requestTimeout; }
    public void setRequestTimeout(Duration requestTimeout) { this.requestTimeout = requestTimeout; }
    public Duration getRequestInterval() { return requestInterval; }
    public void setRequestInterval(Duration requestInterval) { this.requestInterval = requestInterval; }
    public Duration getSafetyDelay() { return safetyDelay; }
    public void setSafetyDelay(Duration safetyDelay) { this.safetyDelay = safetyDelay; }
    public Duration getOverlap() { return overlap; }
    public void setOverlap(Duration overlap) { this.overlap = overlap; }
    public boolean isBootstrapEnabled() { return bootstrapEnabled; }
    public void setBootstrapEnabled(boolean bootstrapEnabled) { this.bootstrapEnabled = bootstrapEnabled; }
    public int getPageSize() { return pageSize; }
    public void setPageSize(int pageSize) { this.pageSize = pageSize; }
    public Instant getInitialCursor() { return initialCursor; }
    public void setInitialCursor(Instant initialCursor) { this.initialCursor = initialCursor; }
}
