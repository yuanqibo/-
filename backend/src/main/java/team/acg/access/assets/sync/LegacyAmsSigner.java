package team.acg.access.assets.sync;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.Map;
import java.util.stream.Collectors;

final class LegacyAmsSigner {
    private LegacyAmsSigner() {}

    static String sign(String token, long timestamp, String param) {
        Map<String, String> values = Map.of(
            "param", param,
            "timestamp", Long.toString(timestamp),
            "token", token);
        String canonical = values.entrySet().stream()
            .sorted(Comparator.comparing(Map.Entry::getKey))
            // The vendor's downloadable Java example signs the raw JSON param value.
            .map(entry -> entry.getKey() + "=" + entry.getValue())
            .collect(Collectors.joining("&"));
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-1")
                .digest(canonical.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException error) {
            throw new IllegalStateException("SHA-1 is unavailable", error);
        }
    }
}
