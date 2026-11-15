# Netcatty Mate v3.1.4 — AI 设置 Promise / 能力契约修复

- 精确复现截图：提供商页首次绘制后约 900ms 的 idle callback 调用桌面可选 aiPrewarmShellEnv；Android 暴露了 async rejecting stub，未 await 的调用导致 Unsupported on Android。旧桥 production dist 重现 index :10:37956 → SettingsAITab :20:31651 → requestIdleCallback :20:24315；不是添加菜单触发网络失败。
- Android 不再暴露无实现的可选 shell 预热、桌面 host/搜索凭据发布器；真实 aiFetch/native HTTP 与 API 提供商本地配置保持可用。没有全局吞错或假成功。
- CLI/SDK、Codex 登录状态、MCP 状态与用户 skills 目录返回真实不可用结构，敏感配置明确失败；设置页显示 Android 能力边界。不宣称桌面 Agent、外部 MCP 或隐私脱敏可用。
- 新增 Actions production-dist Playwright AI 回归：添加菜单 idle 复现、假 key OpenAI 兼容配置本地保存、Agent 自定义路径检查、MCP 配置弹窗/连接刷新、网络搜索配置、安全超时修改；捕获 pageerror/unhandledrejection，修复后均为空，且没有真实 AI 网络请求。
- 保留启动 105 订阅/清理契约、production boot、WebDAV 空/已保存配置与失败/超时恢复、bridge 15、UI 8、cloud restore-only 16、native safety 11、真实 JSch/OpenSSH 11 回归。
- SFTP 保持完整双向操作；云 vault 仅 restore/download，禁止写远端。沿用现有固定签名 secrets，不更换密钥。

版本 3.1.4 / versionCode 314。完整前端与 Android 编译、签名仅在 GitHub Actions。以上为 Chromium + native mock / 隔离 SFTP 服务测试，不是 Android 真机验证；假 key 保存不等于真实 AI 服务连通性测试。全仓 TypeScript 存在既有 desktop baseline，本次工作流仅对既定移动范围执行错误门禁。
