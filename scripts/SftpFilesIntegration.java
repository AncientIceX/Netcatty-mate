import com.jcraft.jsch.*;
import de.newaii.netcatty.SftpFiles;
import java.io.*;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.*;

/** Executes the production helper against pinned JSch and a loopback OpenSSH server. */
public class SftpFilesIntegration {
    static Path root;
    static ChannelSftp sftp;
    static int passed;
    static void check(boolean ok, String message) {
        if (!ok) throw new AssertionError(message);
    }
    static void pass(String name) { passed++; System.out.println("PASS " + name); }
    static String path(String name) { return root.resolve(name).toString(); }
    static void seed(String name, String data, int mode) throws Exception {
        Files.write(root.resolve(name), data.getBytes("UTF-8"));
        sftp.chmod(mode, SftpFiles.literal(path(name)));
    }
    static String read(String name) throws Exception {
        try (InputStream in = sftp.get(SftpFiles.literal(path(name)))) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] b = new byte[4096]; int n;
            while ((n = in.read(b)) != -1) out.write(b, 0, n);
            return out.toString("UTF-8");
        }
    }
    static int mode(String name) throws Exception { return sftp.stat(SftpFiles.literal(path(name))).getPermissions() & 07777; }
    static void replace(String name, String data) throws Exception {
        byte[] bytes = data.getBytes("UTF-8");
        try (SftpFiles.Replacement r = new SftpFiles.Replacement(sftp, path(name))) {
            check((sftp.stat(SftpFiles.literal(r.staging)).getPermissions() & 0777) == 0600, "private stage");
            sftp.put(new ByteArrayInputStream(bytes), SftpFiles.literal(r.staging));
            r.commit(bytes.length);
        }
    }
    public static void main(String[] args) throws Exception {
        root = Paths.get(args[3]);
        JSch jsch = new JSch(); jsch.addIdentity(args[0]); jsch.setKnownHosts(args[1]);
        Session session = jsch.getSession(System.getProperty("user.name"), "127.0.0.1", Integer.parseInt(args[2]));
        session.setConfig("StrictHostKeyChecking", "yes"); session.connect(10000);
        sftp = (ChannelSftp) session.openChannel("sftp"); sftp.connect(10000);
        try {
            for (int mode : new int[]{0600,0755,04750}) {
                String name = "mode-" + mode; seed(name, "old", mode);
                SftpATTRS before = sftp.stat(SftpFiles.literal(path(name)));
                replace(name, "saved");
                SftpATTRS after = sftp.stat(SftpFiles.literal(path(name)));
                check(mode(name) == mode && read(name).equals("saved"), "mode/content");
                check(before.getUId() == after.getUId() && before.getGId() == after.getGId(), "owner/group");
                pass("overwrite preserves " + Integer.toOctalString(mode) + " uid/gid");
            }
            seed("target", "old", 0755); Files.createSymbolicLink(root.resolve("link"), Paths.get("target"));
            replace("link", "edited");
            check(Files.isSymbolicLink(root.resolve("link")) && read("target").equals("edited") && mode("target") == 0755, "symlink target save");
            pass("relative symlink preserved and target changed");
            for (String name : new String[]{"report*", "report?", "report\\", "汉字 [x] *?\\"}) {
                seed(name, "literal", 0644); seed("report-secret", "neighbor", 0644);
                sftp.chmod(0600, SftpFiles.literal(path(name)));
                check(mode(name) == 0600 && mode("report-secret") == 0644, "literal chmod isolation");
                replace(name, "updated"); check(read(name).equals("updated"), "literal write/read");
                String moved = name + "-renamed";
                sftp.rename(SftpFiles.literal(path(name)), SftpFiles.literal(path(moved)));
                check(read(moved).equals("updated"), "literal rename");
                SftpFiles.delete(sftp, path(moved), 0);
                check(!Files.exists(root.resolve(moved)) && read("report-secret").equals("neighbor"), "literal delete");
            }
            pass("literal chmod/read/write/rename/delete *, ?, backslash, Unicode; neighbor untouched");
            String dir = "dir*?\\"; sftp.mkdir(path(dir));
            seed(dir + "/child*?\\", "child", 0600);
            Files.createSymbolicLink(root.resolve(dir).resolve("outside-link"), root.resolve("target"));
            check(sftp.ls(SftpFiles.literal(path(dir))).size() >= 3, "literal directory list");
            SftpFiles.delete(sftp, path(dir), 0);
            check(!Files.exists(root.resolve(dir)) && read("target").equals("edited"), "recursive literal symlink safety");
            pass("raw mkdir and escaped ls/recursive delete do not follow child symlink");
            seed("cancel", "original", 0600);
            try (SftpFiles.Replacement r = new SftpFiles.Replacement(sftp, path("cancel"))) {
                sftp.put(new ByteArrayInputStream(new byte[1048576]), SftpFiles.literal(r.staging), new SftpProgressMonitor() {
                    public void init(int op,String src,String dst,long max) {}
                    public boolean count(long n) { return false; }
                    public void end() {}
                });
                // Native cancellation exits without committing, even if JSch put returns normally.
            }
            check(read("cancel").equals("original") && mode("cancel") == 0600, "cancel preserves original");
            pass("real JSch cancelled upload preserves original");
            try (SftpFiles.Replacement r = new SftpFiles.Replacement(sftp, path("cancel"))) {
                sftp.put(new ByteArrayInputStream(new byte[]{1}), SftpFiles.literal(r.staging));
                try { r.commit(100); throw new AssertionError("short upload accepted"); }
                catch (IOException expected) { check(expected.getMessage().contains("Incomplete"), "short upload error"); }
            }
            check(read("cancel").equals("original"), "short upload preserves original");
            pass("short upload fails without replacing original");
            try { replace("foreign-owner", "unsafe"); throw new AssertionError("owner mismatch accepted"); }
            catch (IOException expected) { check(expected.getMessage().contains("Cannot preserve"), "clear ownership failure"); }
            check(read("foreign-owner").equals("foreign original"), "foreign owner original");
            pass("unrestorable owner fails explicitly before replace");
            replace("brand-new*?\\", "new"); check(read("brand-new*?\\").equals("new"), "new file special path");
            pass("new special-character filename saves normally");
            try (java.util.stream.Stream<Path> files = Files.list(root)) {
                check(!files.anyMatch(p -> p.getFileName().toString().startsWith(".netcatty-write-")), "stage leaked");
            }
            pass("staging cleaned after success, cancellation, size and metadata failure");
            System.out.println("SFTP integration: " + passed + " scenarios passed (JSch 0.2.21 / OpenSSH)");
        } finally { sftp.disconnect(); session.disconnect(); }
    }
}
