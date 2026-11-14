# Netcatty Mate v3.1.2 — Android 启动热修复

修复 v3.1.1 打开即出现 7 次 `[Unhandled Promise] Error: Unsupported on Android`。

## 根因与修复

不是事件订阅故障。重建 v3.1.1 的真实前端后，精确匹配原报告的 bundle/hash/调用位置：

| 原始调用位置 | 源码启动调用 |
| --- | --- |
| `index-B1NgfB7Z.js:116:8943` (`Xwe`)，经 `116:9367` / `116:9374` effect | `externalMcpApprovalAlert.ts:72` → `setExternalMcpApprovalAlertMode`，由 `ExternalMcpApprovalsHost` mount 发布 |
| `index-B1NgfB7Z.js:158:15458` | `useAIPermissionGrantsState.ts:92` → `aiMcpSyncPermissionGrants` |
| `TerminalLayer-DJMoNERS.js:4:322325` | `useAIState.ts:905` → `aiMcpSetCommandBlocklist` |
| `TerminalLayer-DJMoNERS.js:4:322390` | `useAIState.ts:909` → `aiMcpSetCommandTimeout` |
| `TerminalLayer-DJMoNERS.js:4:322450` | `useAIState.ts:911` → `aiMcpSetMaxIterations` |
| `TerminalLayer-DJMoNERS.js:4:322564` | `useAIState.ts:917` → `aiMcpSetPermissionMode` |
| `TerminalLayer-DJMoNERS.js:4:322654` | `useAIState.ts:922` → `aiMcpSetToolIntegrationMode` |

七个可选桌面 MCP publisher 被 Android 错误暴露为 async reject，调用方只检查函数是否存在、不会 await。Android 没有对应 MCP server，现移除这些可选能力，走调用方现有 presence gating；不伪造安全配置成功、不统一 catch 隐藏异常。App lock、备份、OAuth、隐私转换等不支持操作继续明确失败。

## 回归证据

- 同一源码执行测试在 v3.1.1 复现 7 个 unhandled rejection；修后通过。
- 审计全部 105 个 onX 订阅：同步返回可调用的 unsubscribe，重复清理无异常；启动 getters 按实际 shape 通过。
- Actions Playwright 使用明确的 Android NativeBridge mock 加载完整生产 dist，经过 AppLockGate/App/懒加载 TerminalLayer：旧版渲染但有 7 个 rejection；修后 App 渲染（41 个按钮）、无 pageerror、无 unhandledrejection。
- 保留并运行 v3.1.1 的 15 组 bridge runtime、8 项 UI/storage safety、cloud pull-only、native safety 与真实 JSch/OpenSSH 11 场景回归。
- TypeScript 延续移动改动路径检查，不宣称整个桌面仓库零类型错误。

## 安装与限制

版本 3.1.2 / versionCode 312。继续使用 v3.1.0 起保存的同一发布签名，不生成新密钥。保留 v3.1.1 terminal/SFTP/cloud 修复，云端仍仅恢复、SFTP 仍双向。

浏览器 smoke 和原生集成测试不等于 Android 真机测试；本次没有执行真机验证。v3.0.1 及更早版本证书可能不同；卸载会删除本地数据，请先备份。
