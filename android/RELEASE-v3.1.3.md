# Netcatty Mate v3.1.3 — WebDAV 设置卡死修复

## 修复

移动设置全屏层位于 z-index 120；WebDAV 配置 Dialog 原先 portal 到 body（z-index 70，遮罩 50）。点击后表单被设置层完全遮住，同时 Radix modal 禁用背景输入，看起来整个设置卡死。这不是点击时发起网络请求，也没有证据表明是网络或用户配置。

现将移动设置的 modal portal 放入设置层自己的 PortalContainer，复用已有 Select portal 上下文，桌面默认仍使用 body。没有禁用 WebDAV，没有吞异常，没有更改云端写策略。

## 验证

- GitHub Actions 重建 v3.1.2 的 AppView/Dialog，Playwright 实际打开设置 → Sync & Cloud → WebDAV；空配置/已有假配置均复现隐藏表单。对相同流程的前景断言旧版失败，修后成功。
- 修后验证表单可输入、认证失败与异步超时后可重试、Android 返回与取消可关闭、可退出设置；无 pageerror/unhandledrejection。全部使用隔离假凭据和异步 native HTTP fixture，不访问真实用户服务器。
- 保留启动 7 个 rejection 的旧版对照与修后完整生产 dist boot 测试、105 项订阅 cleanup 合同、15 bridge / 8 UI-storage / 16 cloud pull-only / 11 native safety / 11 真实 JSch-OpenSSH 场景。
- TypeScript 沿用移动路径检查，保留桌面既有基线；不宣称全仓库零类型错误。
- 编译与 APK 签名验证仅 GitHub Actions；继续使用既有发布签名。

云同步仍严格只下载恢复，不 PUT/DELETE/MKCOL 或覆盖云端 vault；SFTP 保持正常双向操作。保留 terminal/SFTP 既有修复。

版本 3.1.3 / versionCode 313。本次是 Chromium 生产 UI 与 native 集成验证，不是 Android 真机验证；连接失败/超时 UI 使用 fixture，并非真实 WebDAV 服务端或真机网络验证。v3.0.1 及更早版证书可能不同；卸载前备份本地数据。
