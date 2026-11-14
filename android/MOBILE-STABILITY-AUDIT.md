# Mobile stability audit

Scope: Android terminal bridge lifecycle and native SFTP metadata/literal-path safety.
No release/tag is created by this change; validate the branch artifact on a device before release.

## Reproduced defects and fixes

- Cancelling a paced multiline paste previously left every native-write timer running.
  `interruptSession(..., { cancelPendingWritesOnly: true })` returned without doing anything;
  queued commands could execute after cancellation, Ctrl-C, tab close, or reconnection.
  Track pending writes per session, cancel and invalidate callbacks on interruption,
  close, reconnect, native exit and error. Preserve normal paced writes and acknowledgements.
- Backlog replay used a microtask while live output was dispatched immediately.
  Reproduced output was `newold` instead of `oldnew`, potentially reordering terminal
  escape sequences. Queue live output until replay finishes and suppress replay after
  unsubscription, without making subscription callbacks synchronous.

## Verification

The dependency-free VM tests execute the real TypeScript polyfill, not a second
implementation. Added four regression suites for paste cancellation/close/normal
completion and lifecycle cleanup, plus ordered and unsubscribe-safe replay.

Local commands:

```sh
node scripts/mobile-bridge-test.mjs
node --test scripts/mobile-ui-safety.test.cjs
node --experimental-strip-types --test infrastructure/services/cloudSync/mobilePullOnly.test.ts
python scripts/mobile-native-safety.py  # requires javalang
```

Results: 15 bridge runtime suites, 8 UI/storage tests, 16 cloud restore tests,
and 11 native source checks pass. The native checks parse Java and assert source
invariants; they are not Android device integration tests. Both primary regressions
fail against the original bridge (queued commands still execute; replay is `newold`).

The existing Actions build runs the expanded bridge suite, frontend build,
mobile-scoped TypeScript diagnostics, native Java compile, APK signing and signature
verification. Full-project TypeScript checking retains the existing baseline policy;
this audit does not claim all desktop TypeScript diagnostics are clean.

Cloud sync remains download/restore-only. Explicit SFTP upload/download and file
mutations are unchanged. Existing unsupported app lock, Google/OneDrive OAuth and
cross-server SFTP are not represented as implemented.

Still requires real-device verification: actual SSH server reconnection, slow paced
paste cancellation via UI, output during terminal remount, SFTP cancellation and
cloud restore against real providers. No local frontend/Java/APK build was run.

## Native SFTP follow-up

- Editor saves and overwrite uploads now share `SftpFiles.Replacement`: lstat the
  existing entry, resolve a symlink to its target without replacing the link, stage
  in the target directory, restrict staging to 0600 before payload, verify length,
  restore and read back uid/gid and all 07777 mode bits before rename. If metadata
  cannot be restored, return a clear failure and leave the original untouched.
  New files are deliberately private (0600). No delete-before-rename fallback.
- Checked mwiede JSch 0.2.21 source: glob_remote/isUnique are used by chmod,
  stat/lstat, get/put, rename, rm/rmdir and ls; these receive literal escaping for
  backslash, `*`, `?`. mkdir and realpath send raw paths and must NOT be escaped.
  Recursive deletion uses literal children and lstat, never follows child links.
- Upload cancellation and commit use the same cancellation lock. Cancellation
  observed before commit prevents rename; cancellation after commit cannot undo it.
- Actions executes the actual production helper using pinned JSch 0.2.21 against
  a disposable loopback-only OpenSSH server, not mocks or real user remote files.
  Cases include 0600/0755/set-ID mode and uid/gid preservation, relative symlink
  target save, wildcard/backslash/Unicode literal operations and neighbor isolation,
  recursive deletion with symlink, real progress-monitor cancellation, short upload,
  owner restoration rejection, new files and staging cleanup. Android compilation
  and all Java execution remain in Actions; local bridge/UI tests remain lightweight.

Boundaries: SFTP v3 does not portably expose ACLs, xattrs or hardlink identity;
replacement does not preserve those, inode identity or original timestamps. External
writers/path changes are not locked by the client; no compare-and-swap or fsync
extension is claimed. A disconnected server can retain an uncommitted staging file.
Servers without atomic overwrite-rename support fail without deleting the original.
Dangling symlinks fail rather than replacing the symlink. Android device/UI and
non-OpenSSH servers still require testing. No tag/Release is created.

