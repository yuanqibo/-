package team.acg.access.assets.ecp;

import com.idanchuang.ecp.api.common.model.directory.EcpUserProfile;
import com.idanchuang.ecp.sdk.client.EcpClient;
import com.idanchuang.ecp.sdk.client.model.EcpPage;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
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
        return directoryParty(profile);
    }

    public Map<String, DirectoryParty> requireByNames(Collection<String> names) {
        Set<String> requested = requestedNames(names);
        if (requested.isEmpty()) return Map.of();

        List<EcpUserProfile> candidates = new ArrayList<>();
        for (int pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber++) {
            EcpPage<EcpUserProfile> result = page("", pageNumber, PAGE_SIZE);
            candidates.addAll(result.items());
            if (!result.hasNext()) break;
        }
        return resolveExactNames(requested, candidates);
    }

    public Map<String, DirectoryParty> requireByNames(Collection<String> names,
                                                       Collection<EcpUserProfile> candidates) {
        Set<String> requested = requestedNames(names);
        if (requested.isEmpty()) return Map.of();
        rememberAll(candidates);
        return resolveExactNames(requested, candidates);
    }

    public Map<String, DirectoryParty> requireByEmails(Collection<String> emails) {
        Set<String> requested = requestedEmails(emails);
        if (requested.isEmpty()) return Map.of();

        List<EcpUserProfile> candidates = new ArrayList<>();
        for (int pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber++) {
            EcpPage<EcpUserProfile> result = page("", pageNumber, PAGE_SIZE);
            candidates.addAll(result.items());
            if (!result.hasNext()) break;
        }
        return resolveExactEmails(requested, candidates);
    }

    public Map<String, DirectoryParty> requireByEmails(Collection<String> emails,
                                                        Collection<EcpUserProfile> candidates) {
        Set<String> requested = requestedEmails(emails);
        if (requested.isEmpty()) return Map.of();
        rememberAll(candidates);
        return resolveExactEmails(requested, candidates);
    }

    public Set<String> namesWithoutUniqueMatch(Collection<String> names,
                                               Collection<EcpUserProfile> candidates) {
        Set<String> requested = requestedNames(names);
        if (requested.isEmpty()) return Set.of();
        Map<String, Map<String, EcpUserProfile>> matches = exactNameMatches(requested, candidates);
        Set<String> unresolved = requested.stream()
            .filter(name -> matches.getOrDefault(name, Map.of()).size() != 1)
            .collect(java.util.stream.Collectors.toCollection(LinkedHashSet::new));
        return java.util.Collections.unmodifiableSet(unresolved);
    }

    public Set<String> emailsWithoutUniqueMatch(Collection<String> emails,
                                                Collection<EcpUserProfile> candidates) {
        Set<String> requested = requestedEmails(emails);
        if (requested.isEmpty()) return Set.of();
        Map<String, Map<String, EcpUserProfile>> matches = exactEmailMatches(requested, candidates);
        Set<String> unresolved = requested.stream()
            .filter(email -> matches.getOrDefault(email, Map.of()).size() != 1)
            .collect(java.util.stream.Collectors.toCollection(LinkedHashSet::new));
        return java.util.Collections.unmodifiableSet(unresolved);
    }

    private Map<String, DirectoryParty> resolveExactNames(Set<String> requested,
                                                          Collection<EcpUserProfile> candidates) {
        return resolveExactMatches(requested, exactNameMatches(requested, candidates));
    }

    private Map<String, Map<String, EcpUserProfile>> exactNameMatches(Set<String> requested,
                                                                      Collection<EcpUserProfile> candidates) {
        Map<String, Map<String, EcpUserProfile>> matches = new LinkedHashMap<>();
        if (candidates != null) candidates.stream().filter(java.util.Objects::nonNull).forEach(profile -> {
            String name = text(profile.name());
            String subject = text(profile.unionId());
            if (requested.contains(name)) {
                matches.computeIfAbsent(name, ignored -> new LinkedHashMap<>()).putIfAbsent(subject, profile);
            }
        });
        return matches;
    }

    private Map<String, DirectoryParty> resolveExactMatches(Set<String> requested,
                                                             Map<String, Map<String, EcpUserProfile>> matches) {
        List<String> unresolved = requested.stream()
            .filter(name -> matches.getOrDefault(name, Map.of()).size() != 1)
            .toList();
        if (!unresolved.isEmpty()) {
            String detail = unresolved.stream().limit(10)
                .map(name -> name + "(" + matches.getOrDefault(name, Map.of()).size() + "个匹配)")
                .collect(java.util.stream.Collectors.joining("、"));
            throw new IllegalArgumentException("使用人无法唯一匹配 ECP 账号目录：" + detail
                + (unresolved.size() > 10 ? " 等" + unresolved.size() + "人" : ""));
        }

        Map<String, DirectoryParty> parties = new LinkedHashMap<>();
        requested.forEach(name -> parties.put(name, directoryParty(matches.get(name).values().iterator().next())));
        return Map.copyOf(parties);
    }

    private Map<String, DirectoryParty> resolveExactEmails(Set<String> requested,
                                                            Collection<EcpUserProfile> candidates) {
        Map<String, Map<String, EcpUserProfile>> matches = exactEmailMatches(requested, candidates);
        List<String> unresolved = requested.stream()
            .filter(email -> matches.getOrDefault(email, Map.of()).size() != 1)
            .toList();
        if (!unresolved.isEmpty()) {
            String detail = unresolved.stream().limit(10)
                .map(email -> email + "(" + matches.getOrDefault(email, Map.of()).size() + "个匹配)")
                .collect(java.util.stream.Collectors.joining("、"));
            throw new IllegalArgumentException("电子邮箱无法唯一匹配 ECP 账号目录：" + detail
                + (unresolved.size() > 10 ? " 等" + unresolved.size() + "个" : ""));
        }
        Map<String, DirectoryParty> parties = new LinkedHashMap<>();
        requested.forEach(email -> parties.put(email, directoryParty(matches.get(email).values().iterator().next())));
        return Map.copyOf(parties);
    }

    private Map<String, Map<String, EcpUserProfile>> exactEmailMatches(Set<String> requested,
                                                                       Collection<EcpUserProfile> candidates) {
        Map<String, Map<String, EcpUserProfile>> matches = new LinkedHashMap<>();
        if (candidates != null) candidates.stream().filter(java.util.Objects::nonNull).forEach(profile -> {
            String email = email(profile.email());
            String subject = text(profile.unionId());
            if (requested.contains(email)) {
                matches.computeIfAbsent(email, ignored -> new LinkedHashMap<>()).putIfAbsent(subject, profile);
            }
        });
        return matches;
    }

    private Set<String> requestedNames(Collection<String> names) {
        Set<String> requested = new LinkedHashSet<>();
        if (names != null) names.stream().map(EcpDirectoryUserService::text)
            .filter(value -> !value.isEmpty()).forEach(requested::add);
        return requested;
    }

    private Set<String> requestedEmails(Collection<String> emails) {
        Set<String> requested = new LinkedHashSet<>();
        if (emails != null) emails.stream().map(EcpDirectoryUserService::email)
            .filter(value -> !value.isEmpty()).forEach(requested::add);
        return requested;
    }

    public void rememberAll(Collection<EcpUserProfile> values) {
        if (values == null) return;
        values.forEach(this::remember);
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

    private DirectoryParty directoryParty(EcpUserProfile profile) {
        String subject = text(profile.unionId());
        String name = text(profile.name());
        if (subject.isEmpty() || name.isEmpty()) {
            throw new IllegalArgumentException("ECP directory user is missing a subject or display name");
        }
        EcpUserProfile.DepartmentSummary department = profile.departments() == null || profile.departments().isEmpty()
            ? null : profile.departments().get(0);
        EcpUserProfile.CompanySummary company = profile.company();
        return new DirectoryParty(subject, name,
            department == null ? "" : text(department.unionId()),
            department == null ? "" : text(department.name()),
            company == null ? "" : text(company.unionId()),
            company == null ? "" : text(company.name()));
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

    private static String email(String value) {
        return text(value).toLowerCase(java.util.Locale.ROOT);
    }

    public record DirectoryParty(String subject, String name, String departmentUnionId, String department,
                                 String companyUnionId, String company) {}

    private record PageKey(String query, int page, int size) {}
    private record CachedPage(EcpPage<EcpUserProfile> page, long expiresAtMillis) {}
    private record CachedProfile(EcpUserProfile profile, long expiresAtMillis) {}
}
