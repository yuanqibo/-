package team.acg.access.assets.systemconfig;

import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Base64;

@Component
final class SystemConfigSecretCipher {
    private static final byte FORMAT_VERSION = 1;
    private static final int IV_BYTES = 12;
    private static final int TAG_BITS = 128;

    private final String encodedKey;
    private final boolean ecpEnabled;
    private final SecureRandom random = new SecureRandom();

    SystemConfigSecretCipher(@Value("${asset-portal.system-config.encryption-key:}") String encodedKey,
                             @Value("${ecp.sdk.enabled:true}") boolean ecpEnabled) {
        this.encodedKey = encodedKey == null ? "" : encodedKey.trim();
        this.ecpEnabled = ecpEnabled;
    }

    @PostConstruct
    void validateConfiguration() {
        if (!ecpEnabled) return;
        try {
            encryptionKey();
        } catch (ResponseStatusException error) {
            throw new IllegalStateException("ASSET_PORTAL_SYSTEM_CONFIG_ENCRYPTION_KEY must be a Base64 encoded 32-byte key", error);
        }
    }

    String encrypt(String plaintext) {
        if (plaintext == null) return null;
        byte[] key = encryptionKey();
        byte[] iv = new byte[IV_BYTES];
        random.nextBytes(iv);
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(TAG_BITS, iv));
            byte[] ciphertext = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
            ByteBuffer payload = ByteBuffer.allocate(1 + iv.length + ciphertext.length)
                .put(FORMAT_VERSION).put(iv).put(ciphertext);
            return Base64.getEncoder().encodeToString(payload.array());
        } catch (GeneralSecurityException error) {
            throw new IllegalStateException("Integration secret encryption failed", error);
        }
    }

    private byte[] encryptionKey() {
        if (encodedKey.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                "System integration secret encryption is not configured");
        }
        final byte[] key;
        try {
            key = Base64.getDecoder().decode(encodedKey);
        } catch (IllegalArgumentException error) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                "System integration secret encryption key is invalid");
        }
        if (key.length != 32) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                "System integration secret encryption key must decode to 32 bytes");
        }
        return key;
    }
}
