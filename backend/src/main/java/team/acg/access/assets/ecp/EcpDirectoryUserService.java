package team.acg.access.assets.ecp;

import com.idanchuang.ecp.api.common.model.directory.EcpUserProfile;
import com.idanchuang.ecp.sdk.client.EcpClient;
import com.idanchuang.ecp.sdk.client.model.EcpPage;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Service
@ConditionalOnProperty(prefix = "ecp.sdk", name = "enabled", havingValue = "true")
public class EcpDirectoryUserService {
    private static final int PAGE_SIZE = 100;
    private static final int MAX_PAGES = 100;
    private static final long PAGE_CACHE_TTL_MILLIS = Duration.ofMinutes(1).toMillis();
    private static final long CACHE_TTL_MILLIS = Duration.ofMinutes(5).toMillis();

    private final EcpClient client;
    private final Map<PageKey, CachedPage> pages = new ConcurrentHashMap<>();
    private final Map<String, CachedProfile> profiles = new ConcurrentHashMap<>();

    public EcpDirectoryUserService(EcpClient client) {
        this.client = client;
    }

    public EcpPage<EcpUserProfile> page(String query, int page, int size) {
        pruneExpiredProfiles();
        String normalizedQuery = text(query);
        long now = System.currentTimeMillis();
        PageKey key = new PageKey(normalizedQuery, page, size);
        CachedPage cached = pages.compute(key, (ignored, current) -> {
            if (current != null && current.expiresAtMillis() > now) return current;
            EcpPage<EcpUserProfile> loaded = normalizedQuery.isEmpty()
                ? client.directory().users().list(page, size)
                : client.directory().users().search(normalizedQuery, page, size);
            return new CachedPage(loaded, System.currentTimeMillis() + PAGE_CACHE_TTL_MILLIS);
        });
        EcpPage<EcpUserProfile> result = cached.page();
        result.items().forEach(this::remember);
        return result;
    }

    public DirectoryParty requireBySubject(String subject) {
        String normalized = text(subject);
        if (normalized.isEmpty() || normalized.length() > 191 || normalized.chars().anyMatch(value -> value < 0x20)) {
            throw new IllegalArgumentException("A valid ECP directory user subject is required");
        }
        EcpUserProfile profile = cached(normalized);
        if (profile == null) profile = findInApplicationDirectory(normalized);
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

    private EcpUserProfile findInApplicationDirectory(String subject) {
        EcpPage<EcpUserProfile> searchResult = page(subject, 1, PAGE_SIZE);
        EcpUserProfile match = exactMatch(searchResult, subject);
        if (match != null) return match;

        for (int pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber++) {
            EcpPage<EcpUserProfile> result = page("", pageNumber, PAGE_SIZE);
            match = exactMatch(result, subject);
            if (match != null) return match;
            if (!result.hasNext()) break;
        }
        return null;
    }

    private EcpUserProfile exactMatch(EcpPage<EcpUserProfile> result, String subject) {
        return result.items().stream()
            .filter(profile -> subject.equals(text(profile.unionId())))
            .findFirst()
            .orElse(null);
    }

    private void remember(EcpUserProfile profile) {
        String subject = profile == null ? "" : text(profile.unionId());
        if (!subject.isEmpty()) {
            profiles.put(subject, new CachedProfile(profile, System.currentTimeMillis() + CACHE_TTL_MILLIS));
        }
    }

    private EcpUserProfile cached(String subject) {
        CachedProfile cached = profiles.get(subject);
        if (cached == null) return null;
        if (cached.expiresAtMillis() >= System.currentTimeMillis()) return cached.profile();
        profiles.remove(subject, cached);
        return null;
    }

    private void pruneExpiredProfiles() {
        long now = System.currentTimeMillis();
        pages.forEach((key, cached) -> {
            if (cached.expiresAtMillis() < now) pages.remove(key, cached);
        });
        profiles.forEach((subject, cached) -> {
            if (cached.expiresAtMillis() < now) profiles.remove(subject, cached);
        });
    }

    private static String text(String value) {
        return value == null ? "" : value.trim();
    }

    public record DirectoryParty(String subject, String name, String departmentUnionId, String department,
                                 String companyUnionId, String company) {}

    private record PageKey(String query, int page, int size) {}
    private record CachedPage(EcpPage<EcpUserProfile> page, long expiresAtMillis) {}
    private record CachedProfile(EcpUserProfile profile, long expiresAtMillis) {}
}
