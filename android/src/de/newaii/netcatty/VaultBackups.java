package de.newaii.netcatty;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import org.json.*;

/** Private, encrypted, durable snapshots. All methods run on the bridge IO pool. */
public final class VaultBackups {
    public interface Crypto {
        String encrypt(String text) throws Exception;
        String decrypt(String text) throws Exception;
    }
    public interface DirectorySync { void sync(File directory) throws Exception; }
    private final File directory;
    private final Crypto crypto;
    private final DirectorySync sync;
    private static final long MAX_FILE = 24L * 1024 * 1024;
    private static final long MAX_TOTAL = 64L * 1024 * 1024;
    private static final int MAX_PAYLOAD = 16 * 1024 * 1024;

    public VaultBackups(File directory, Crypto crypto, DirectorySync sync) {
        this.directory = directory; this.crypto = crypto; this.sync = sync;
    }
    private void prepare() throws Exception {
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("Cannot create private backup directory");
        if (!directory.setReadable(false, false) || !directory.setWritable(false, false)
                || !directory.setExecutable(false, false) || !directory.setReadable(true, true)
                || !directory.setWritable(true, true) || !directory.setExecutable(true, true))
            throw new IOException("Cannot restrict backup directory");
    }
    private File file(String id) {
        if (id == null || !id.matches("[0-9a-f-]{36}")) throw new IllegalArgumentException("Invalid backup id");
        return new File(directory, id + ".vault");
    }
    private File[] files() throws Exception {
        prepare();
        File[] result = directory.listFiles(new FilenameFilter() {
            public boolean accept(File dir, String name) { return name.matches("[0-9a-f-]{36}\\.vault"); }
        });
        if (result == null) throw new IOException("Cannot list backups");
        Arrays.sort(result, new Comparator<File>() {
            public int compare(File a, File b) { return Long.compare(b.lastModified(), a.lastModified()); }
        });
        return result;
    }
    private String readText(File f) throws Exception {
        if (!f.isFile() || f.length() > MAX_FILE) throw new IOException("Invalid backup size");
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (InputStream in = new FileInputStream(f)) {
            byte[] buf = new byte[8192]; int n;
            while ((n = in.read(buf)) != -1) {
                if (out.size() + n > MAX_FILE) throw new IOException("Backup too large");
                out.write(buf, 0, n);
            }
        }
        return new String(out.toByteArray(), StandardCharsets.UTF_8);
    }
    private static String fingerprint(String text) throws Exception {
        byte[] bytes = MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8));
        StringBuilder hex = new StringBuilder();
        for (byte b : bytes) hex.append(String.format(Locale.US, "%02x", b & 255));
        return hex.toString();
    }
    private JSONObject decode(File f) throws Exception {
        JSONObject record = new JSONObject(crypto.decrypt(readText(f)));
        JSONObject backup = record.getJSONObject("backup");
        if (!file(backup.getString("id")).equals(f)
                || !backup.getString("fingerprint").equals(fingerprint(record.getString("payloadJson"))))
            throw new IOException("Backup verification failed");
        return record;
    }
    public synchronized JSONObject create(JSONObject options) throws Exception {
        JSONObject payload = options.getJSONObject("payload");
        String text = payload.toString();
        if (text.getBytes(StandardCharsets.UTF_8).length > MAX_PAYLOAD) throw new IOException("Vault backup too large");
        String reason = options.optString("reason");
        if (!"before_restore".equals(reason) && !"app_version_change".equals(reason)) throw new IllegalArgumentException("Invalid backup reason");
        prepare();
        String id = UUID.randomUUID().toString();
        JSONObject preview = new JSONObject();
        String[] fields = {"hosts", "keys", "snippets", "notes", "identities", "portForwardingRules"};
        String[] counts = {"hostCount", "keyCount", "snippetCount", "noteCount", "identityCount", "portForwardingRuleCount"};
        for (int i = 0; i < fields.length; i++) {
            JSONArray a = payload.optJSONArray(fields[i]); preview.put(counts[i], a == null ? 0 : a.length());
        }
        JSONObject backup = new JSONObject().put("id", id).put("createdAt", System.currentTimeMillis())
                .put("reason", reason).put("fingerprint", fingerprint(text)).put("preview", preview);
        for (String key : new String[]{"sourceAppVersion", "targetAppVersion", "syncDataVersion"})
            if (options.has(key)) backup.put(key, options.get(key));
        JSONObject record = new JSONObject().put("formatVersion", 1).put("backup", backup).put("payloadJson", text);
        byte[] encrypted = crypto.encrypt(record.toString()).getBytes(StandardCharsets.UTF_8);
        if (encrypted.length > MAX_FILE) throw new IOException("Encrypted backup too large");
        long used = encrypted.length;
        for (File f : files()) used += f.length();
        // Never prune the last good snapshot before the new one is durable.
        if (used > MAX_TOTAL) throw new IOException("Private backup quota reached; clear older local backups first");
        File target = file(id), temp = new File(directory, id + ".pending");
        try {
            if (!temp.createNewFile()) throw new IOException("Backup collision");
            if (!temp.setReadable(false, false) || !temp.setWritable(false, false)
                    || !temp.setReadable(true, true) || !temp.setWritable(true, true)) throw new IOException("Cannot restrict backup file");
            try (FileOutputStream out = new FileOutputStream(temp)) { out.write(encrypted); out.flush(); out.getFD().sync(); }
            // Authenticate and compare the entire snapshot before committing.
            JSONObject verified = new JSONObject(crypto.decrypt(readText(temp)));
            if (!verified.toString().equals(record.toString())) throw new IOException("Backup readback mismatch");
            if (!temp.renameTo(target)) throw new IOException("Atomic backup commit failed");
            sync.sync(directory);
            if (!decode(target).getString("payloadJson").equals(text)) throw new IOException("Backup readback failed");
            trim(options.optInt("maxCount", 10));
            return new JSONObject().put("created", true).put("backup", backup);
        } finally { if (temp.exists() && !temp.delete()) throw new IOException("Backup temporary cleanup failed"); }
    }
    public synchronized JSONArray list() throws Exception {
        JSONArray out = new JSONArray();
        for (File f : files()) out.put(decode(f).getJSONObject("backup"));
        return out;
    }
    public synchronized JSONObject read(String id) throws Exception {
        JSONObject record = decode(file(id));
        return new JSONObject().put("backup", record.getJSONObject("backup"))
                .put("payload", new JSONObject(record.getString("payloadJson")));
    }
    public synchronized JSONObject trim(int maxCount) throws Exception {
        int keep = Math.max(1, Math.min(20, maxCount)), deleted = 0;
        File[] entries = files();
        for (int i = keep; i < entries.length; i++) {
            if (!entries[i].delete()) throw new IOException("Cannot prune backup"); deleted++;
        }
        sync.sync(directory);
        return new JSONObject().put("deletedCount", deleted).put("keptCount", Math.min(keep, entries.length));
    }
    public synchronized JSONObject clear() throws Exception {
        int deleted = 0;
        for (File f : files()) { if (!f.delete()) throw new IOException("Cannot clear backup"); deleted++; }
        File[] pending = directory.listFiles(new FilenameFilter() {
            public boolean accept(File dir, String name) { return name.matches("[0-9a-f-]{36}\\.pending"); }
        });
        if (pending == null) throw new IOException("Cannot list pending backups");
        for (File f : pending) { if (!f.delete()) throw new IOException("Cannot clear pending backup"); deleted++; }
        sync.sync(directory);
        return new JSONObject().put("deletedCount", deleted);
    }
}
