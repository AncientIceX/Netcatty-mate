package de.newaii.netcatty;

import com.jcraft.jsch.ChannelSftp;
import com.jcraft.jsch.SftpATTRS;
import com.jcraft.jsch.SftpException;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.UUID;
import java.util.Vector;

/** Literal file operations for mwiede JSch 0.2.21 (not shell escaping). */
public final class SftpFiles {
    private SftpFiles() {}

    // glob_remote/isUnique/ls unquote backslashes; mkdir and realpath do NOT.
    public static String literal(String path) {
        if (path == null || path.isEmpty() || path.indexOf('\0') >= 0) throw new IllegalArgumentException("Invalid remote path");
        return path.replace("\\", "\\\\").replace("*", "\\*").replace("?", "\\?");
    }

    public static void delete(ChannelSftp sftp, String path, int depth) throws Exception {
        if (depth > 128) throw new IOException("Directory nesting too deep");
        SftpATTRS attrs = sftp.lstat(literal(path));
        if (attrs.isDir() && !attrs.isLink()) {
            Vector<ChannelSftp.LsEntry> entries = sftp.ls(literal(path));
            for (ChannelSftp.LsEntry entry : entries) {
                String name = entry.getFilename();
                if (".".equals(name) || "..".equals(name)) continue;
                if (name.indexOf('/') >= 0) throw new IOException("Invalid directory entry");
                delete(sftp, path + "/" + name, depth + 1);
            }
            sftp.rmdir(literal(path));
        } else {
            sftp.rm(literal(path));
        }
    }

    /** Caller holds channel lock across construction, transfer, commit and close. */
    public static final class Replacement implements AutoCloseable {
        private final ChannelSftp sftp;
        public final String target;
        public final String staging;
        private final SftpATTRS original;

        public Replacement(ChannelSftp sftp, String path) throws Exception {
            this.sftp = sftp;
            literal(path); // Validate without changing raw realpath input.
            SftpATTRS entry = null;
            try { entry = sftp.lstat(literal(path)); }
            catch (SftpException e) { if (e.id != ChannelSftp.SSH_FX_NO_SUCH_FILE) throw e; }
            if (entry != null) {
                // realpath follows final and intermediate links: retain the link itself.
                target = sftp.realpath(path);
                original = sftp.lstat(literal(target));
                if (!original.isReg()) throw new IOException("Save target is not a regular file (or is a dangling symlink)");
                if ((original.getFlags() & 6) != 6) throw new IOException("Cannot preserve target owner/group/permissions: server omitted metadata");
            } else {
                int slash = path.lastIndexOf('/');
                String name = path.substring(slash + 1);
                if (name.isEmpty() || ".".equals(name) || "..".equals(name)) throw new IOException("Invalid save filename");
                target = sftp.realpath(slash < 0 ? "." : slash == 0 ? "/" : path.substring(0, slash)) + "/" + name;
                original = null;
            }
            staging = target.substring(0, target.lastIndexOf('/') + 1) + ".netcatty-write-" + UUID.randomUUID().toString();
            try {
                sftp.put(new ByteArrayInputStream(new byte[0]), literal(staging), ChannelSftp.OVERWRITE);
                // Restrict before any payload is sent, including brand-new files.
                sftp.chmod(0600, literal(staging));
            } catch (Exception e) {
                close();
                throw e;
            }
        }

        public void commit(long expectedSize) throws Exception {
            SftpATTRS staged = sftp.lstat(literal(staging));
            if (staged.getSize() != expectedSize) throw new IOException("Incomplete upload/write");
            if (original != null) {
                try {
                    if (staged.getUId() != original.getUId()) sftp.chown(original.getUId(), literal(staging));
                    if (staged.getGId() != original.getGId()) sftp.chgrp(original.getGId(), literal(staging));
                    // chown/chgrp may clear set-ID bits; apply mode last, then read back.
                    sftp.chmod(original.getPermissions() & 07777, literal(staging));
                    staged = sftp.lstat(literal(staging));
                    if (staged.getUId() != original.getUId() || staged.getGId() != original.getGId()
                            || (staged.getPermissions() & 07777) != (original.getPermissions() & 07777)) {
                        throw new IOException("Metadata verification failed");
                    }
                } catch (Exception e) {
                    throw new IOException("Cannot preserve target owner/group/permissions; original file unchanged", e);
                }
            }
            // Do not delete destination as a fallback: unsupported atomic overwrite fails safely.
            sftp.rename(literal(staging), literal(target));
        }

        @Override public void close() {
            try { sftp.rm(literal(staging)); } catch (Exception ignored) { /* disconnected server may retain staging */ }
        }
    }
}
