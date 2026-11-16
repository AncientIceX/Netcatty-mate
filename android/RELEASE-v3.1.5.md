## 云端严格仅拉取恢复

- Android WebDAV 初始化原本已使用只读 PROPFIND，不是 MKCOL/PUT。新增 JS + 原生 cloudReadFetchAsync 双层 GET/HEAD/PROPFIND 白名单，WebDAV/S3 拉取走专用只读入口；SFTP 和 AI HTTP 不受限制。
- WebDAV 401 明确提示核对地址、用户名和密码/应用专用密码，403 单独提示读取权限；无自动认证重试。未访问任何生产 WebDAV、未读取或改动用户凭据。无法从截图判断具体哪项凭据有误，也不承诺升级即可解决服务器拒绝认证。
- Android 原来把 Digest 配置当作 Basic 发送；现在明确拒绝尚未支持的 Digest，不静默降级。Basic 的 UTF-8 编码保留，Bearer 支持保留。
- 空远端报告没有可恢复备份，不再误报恢复成功；不会自动创建目录或上传备份。异常 HTTP 初始化状态不再误报连接成功。
- 云端按钮和说明明确拉取恢复，隐藏手机端上传合并策略与收敛迁移入口；保留定时拉取和所有 v3.1.4 修复。

## 验证范围

新增实际 TypeScript bridge + 隔离 loopback HTTP 认证 fixture：正确/错误密码、中文特殊字符 Basic、404 空远端、地址尾斜杠、直接文件地址、重定向拒绝、写接口阻断；记录每次 HTTP 方法，证明零远端写。传输由 Node fetch test adapter 执行，不等同 Android 真机原生 HTTP 测试。

GitHub Actions 执行生产 dist 云设置拉取按钮及 401/超时恢复、启动/AI/WebDAV 回归、bridge/runtime、原生语法与安全检查、真实 JSch/OpenSSH 隔离集成、Android 编译与固定签名验证。未做真机测试。
