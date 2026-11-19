# Netcatty Mate v3.1.6

- Implement Android protective local vault backups instead of rejecting restore with `Unsupported on Android` when local connections already exist. Full supplied SyncPayload is encrypted using Android Keystore AES-GCM, stored in the app-private no-backup directory, fsynced and atomically committed, then decrypted and verified before apply is permitted. Existing protected-apply/sentinel contract remains unchanged: backup failures abort restoration.
- Local backup list/read/restore, pruning and clear are backed by native storage. Snapshots are device-bound; uninstalling the app or losing the Keystore key makes them unrecoverable. Maximum 20 snapshots, 16 MiB payload per snapshot, 64 MiB encrypted total; quota failure aborts safely rather than deleting the last valid snapshot.
- Preserve desktop-compatible recovery of complete WebDAV JSON followed by stale trailing bytes; truncated JSON still fails.
- Preserve plaintext service credentials during Android hydration; report unreadable device-bound credentials instead of silently turning them into empty passwords. No claim that this proves or fixes every reported CD2 401.
- Cloud synchronization remains download-only; SFTP remains bidirectional.

Validation: source-executing protected-apply/mobile bridge regression with populated/empty vault and injected backup failure; loopback actual PC WebDAV/mobile Basic parity; native production backup store integration on JVM with an AES-GCM test cipher; Android compilation/signature checks in Actions. JVM tests do not exercise AndroidKeyStore hardware or an actual user CD2 instance. Android-device recovery remains a device-level verification step.
