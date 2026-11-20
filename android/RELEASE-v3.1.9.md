# Netcatty Mate v3.1.9 (319)

- 修复在活动终端点击服务器列表时，布局重排调用 acquireSessionFlowPauseLease 导致 Unsupported on Android。
- 实现 Android 原生输出暂停、64KiB 信用窗口背压、按会话隔离的并行租约、直接水位暂停、顺序屏障与 xterm drain 确认。暂停只影响输出读取，不发送 XOFF/XON，不阻止 SSH 输入。
- 未挂载终端的输出保留并按顺序重放，不再截断 128KiB backlog；UTF-8 跨块解码保持连续。租约释放 finally、过期、close 和重连清理，旧连接输出不能写入替换连接。
- 保留云端只读拉取、双向 SFTP、AI 隐私、本地加密保护备份和工具抽屉。

## Verification

GitHub Actions runs source-executing old/fixed bridge regressions; production-dist Playwright uses real server-list toolbar clicks at 375/390/320px while a deterministic synthetic native stream runs. Compare the actual xterm buffer against the complete ordered fixture, and require zero pageerror/unhandledrejection. No user script or real server is executed.

Additional gates: concurrent leases/direct pause/keepPaused/expiry, isolation, close/reconnect, split UTF-8, detached 180000-byte replay, output gate JVM concurrency, encrypted backup JVM integration, loopback real JSch SFTP, Java/frontend compilation and APK signature verification using the existing signing secret.

The read-only xterm buffer test hook is compiled only into the CI fixture bundle, not the shipping APK. Existing filtered mobile TypeScript checks do not establish whole-repository typecheck success. Physical Android device/SSH integration and real AI provider credentials are not exercised by the browser fixture.
