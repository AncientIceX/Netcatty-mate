import de.newaii.netcatty.VaultBackups;
import java.io.*;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import javax.crypto.*;
import javax.crypto.spec.*;
import org.json.*;

/** Executes production backup store on JVM; AES-GCM substitute for AndroidKeyStore. */
public class VaultBackupsIntegration {
    static void check(boolean condition) { if (!condition) throw new AssertionError(); }
    public static void main(String[] args) throws Exception {
        File dir = new File(args[0]);
        final byte[] key = new byte[32]; new java.security.SecureRandom().nextBytes(key);
        final boolean[] fail = {false};
        VaultBackups.Crypto crypto = new VaultBackups.Crypto() {
            public String encrypt(String text) throws Exception {
                if (fail[0]) throw new IOException("Injected encryption failure");
                Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
                c.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"));
                byte[] cipher = c.doFinal(text.getBytes(StandardCharsets.UTF_8));
                byte[] all = new byte[12 + cipher.length];
                System.arraycopy(c.getIV(), 0, all, 0, 12); System.arraycopy(cipher, 0, all, 12, cipher.length);
                return Base64.getEncoder().encodeToString(all);
            }
            public String decrypt(String text) throws Exception {
                byte[] all = Base64.getDecoder().decode(text);
                Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
                c.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, all, 0, 12));
                return new String(c.doFinal(all, 12, all.length - 12), StandardCharsets.UTF_8);
            }
        };
        VaultBackups.DirectorySync sync = new VaultBackups.DirectorySync() {
            public void sync(File directory) throws Exception {
                try (java.nio.channels.FileChannel ch = java.nio.channels.FileChannel.open(directory.toPath(), StandardOpenOption.READ)) { ch.force(true); }
            }
        };
        VaultBackups store = new VaultBackups(dir, crypto, sync);
        JSONObject payload = new JSONObject("{\"hosts\":[{\"id\":\"local\",\"password\":\"ssh-secret-雪\"}],\"keys\":[{\"privateKey\":\"private-key-fixture\"}],\"settings\":{\"webdavPassword\":\"dav-secret\"}}");
        JSONObject options = new JSONObject().put("payload", payload).put("reason", "before_restore").put("maxCount", 2);
        String id = store.create(options).getJSONObject("backup").getString("id");
        check(store.read(id).getJSONObject("payload").toString().equals(payload.toString()));
        check(new VaultBackups(dir, crypto, sync).read(id).getJSONObject("payload").toString().equals(payload.toString()));
        for (File f : dir.listFiles()) {
            String disk = new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8);
            check(!disk.contains("ssh-secret") && !disk.contains("private-key") && !disk.contains("dav-secret"));
            check(!Files.getPosixFilePermissions(f.toPath()).toString().contains("GROUP"));
        }
        fail[0] = true;
        try { store.create(options); throw new AssertionError("Failure swallowed"); } catch (IOException expected) {}
        fail[0] = false;
        check(store.read(id).getJSONObject("payload").toString().equals(payload.toString()));
        for (int i = 0; i < 4; i++) { Thread.sleep(5); store.create(options); }
        check(store.list().length() == 2);
        id = store.list().getJSONObject(0).getString("id");
        File f = new File(dir, id + ".vault"); byte[] disk = Files.readAllBytes(f.toPath()); disk[15] = (byte)(disk[15] == 'A' ? 'B' : 'A'); Files.write(f.toPath(), disk);
        try { store.read(id); throw new AssertionError("Tamper accepted"); } catch (Exception expected) { check(!(expected instanceof RuntimeException)); }
        try { store.read("../outside"); throw new AssertionError(); } catch (IllegalArgumentException expected) {}
        check(store.clear().getInt("deletedCount") == 2);
        System.out.println("PASS native store: encrypted durable roundtrip/reopen, secrets absent, private files, failure preserves original, retention, tamper/path rejection, clear");
    }
}
