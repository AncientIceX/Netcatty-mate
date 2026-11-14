package de.newaii.netcatty;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Arrays;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Device-local credentials only; unrelated to portable cloud vault encryption. */
final class CredentialCipher {
    private static final String ALIAS = "netcatty.credentials.v1";
    private static final String PREFIX = "enc:v1:android-keystore:";
    private static final byte[] AAD = PREFIX.getBytes(StandardCharsets.UTF_8);

    private static synchronized SecretKey key(boolean create) throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (!store.containsAlias(ALIAS)) {
            if (!create) throw new IllegalStateException("Credential key unavailable");
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setRandomizedEncryptionRequired(true).setKeySize(256).build());
            generator.generateKey();
        }
        return (SecretKey) store.getKey(ALIAS, null);
    }

    static String encrypt(String plaintext) throws Exception {
        if (plaintext == null) throw new IllegalArgumentException("Missing credentials");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding", "AndroidKeyStoreBCWorkaround");
        cipher.init(Cipher.ENCRYPT_MODE, key(true)); // Keystore generates a fresh IV.
        cipher.updateAAD(AAD);
        byte[] iv = cipher.getIV();
        if (iv.length != 12) throw new IllegalStateException("Unexpected GCM IV");
        byte[] encrypted = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
        byte[] packed = new byte[iv.length + encrypted.length];
        System.arraycopy(iv, 0, packed, 0, iv.length);
        System.arraycopy(encrypted, 0, packed, iv.length, encrypted.length);
        return PREFIX + Base64.encodeToString(packed, Base64.NO_WRAP);
    }

    static String decrypt(String value) throws Exception {
        if (value == null) throw new IllegalArgumentException("Missing credentials");
        if (!value.startsWith(PREFIX)) {
            // Migration only: this legacy marker was plaintext, not encryption.
            if (value.startsWith("enc:v1:")) return value.substring("enc:v1:".length());
            throw new IllegalArgumentException("Unknown credential format");
        }
        byte[] packed = Base64.decode(value.substring(PREFIX.length()), Base64.NO_WRAP);
        if (packed.length < 28) throw new IllegalArgumentException("Invalid credential ciphertext");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding", "AndroidKeyStoreBCWorkaround");
        cipher.init(Cipher.DECRYPT_MODE, key(false), new GCMParameterSpec(128, Arrays.copyOfRange(packed, 0, 12)));
        cipher.updateAAD(AAD);
        return new String(cipher.doFinal(packed, 12, packed.length - 12), StandardCharsets.UTF_8);
    }

    static boolean available() {
        try {
            String probe = "credential-keystore-check";
            return probe.equals(decrypt(encrypt(probe)));
        } catch (Exception e) {
            return false;
        }
    }
}
