# Netcatty Mate v3.2.0 (320)

- 修复手机进入 SSH/本地终端后一片空白、无法输入：底部快捷键栏在横向布局中把终端挤成 0 宽度。现在快捷键栏固定在底部（软键盘上方），终端占满剩余空间。
- 参考 Termius 手机版：点按终端即弹出软键盘；快捷键栏新增键盘按钮，原生 `showSoftKeyboard` 兜底唤起输入法；点快捷键不再收起键盘。
- CTRL/ALT 改为粘滞修饰键：按下后作用于下一个用软键盘输入的字符（如 CTRL 然后 c = Ctrl+C），用完自动释放；粘贴和转义序列不受影响。
- 方向键遵循应用光标模式（vim/less/htop 正常）；按键高度 36px，深浅主题均清晰可见；常用键（^C、/、-、|、~）前置。

## Verification

GitHub Actions builds the v3.1.9 TerminalView and reproduces the squeezed terminal in production dist, then verifies the fixed build at 320/375/390px portrait and 844px landscape with light and dark themes: terminal width/height, keybar docked at bottom, tap focuses xterm input and requests the IME, typed text, ESC/arrow keys and sticky Ctrl reach the session, zero pageerror/unhandledrejection. Unit tests cover the modifier store. A synthetic local shell is used; physical device IME behaviour and real SSH servers are not exercised in CI.
