# DeepSeek Harness Desktop

[中文](#中文) · [English](#english)

## 中文

面向 Windows 的 DeepSeek Harness 轻量桌面套壳。它在本机启动 `dsh web`，并展示**未经修改**的 Harness 原界面，不重做对话、插件或模型设置。

Harness 本身仍是 DeepSeek 的项目。本仓库只是桌面包装，不是 DeepSeek 官方产品。

### 桌面端负责什么

- 检测 Node.js、npm 和 `@deepseek-ai/dsh`
- 缺少依赖时提供三个明确选项：**自动安装**、**手动安装**、**暂不安装**
- 把 Harness 绑在本机回环地址 `127.0.0.1`，不打开外部浏览器
- 补充窄状态栏、托盘、开机自启、日志和桌面端更新

主窗口关闭后，默认最小化到托盘。彻底退出请用托盘里的 **Quit**。

### 安装选择

首次启动若缺依赖，向导会让你选：

1. **自动安装**：先展示来源、版本和命令，确认后才执行。Node.js 走 Windows 包管理器（winget）的 `OpenJS.NodeJS.LTS`；`dsh` 走 npm 官方包 `@deepseek-ai/dsh`。
2. **手动安装**：给出官方链接和可复制命令，装完点「重新检测」。
3. **暂不安装**：进入受限模式，只保留诊断和桌面设置。

升级同样不会静默执行，需要你确认。

### 安装包

Windows 安装版和便携版发布在 [GitHub Releases](https://github.com/AOwangjian/deepseek-harness-desktop/releases)。

未签名的首次运行可能触发 SmartScreen「未知发布者」提示。在配置可信代码签名证书之前，这是预期行为。

Harness 只监听本机，不默认开放局域网或远程访问。

### 开发

需要 Node.js 22+。

```bash
npm install
npm run typecheck
npm test
npm run test:integration
npm run dev
```

本地打包：

```bash
npm run build
npm run test:e2e
npm run dist
npm run dist:portable
```

`npm run dist` 生成 NSIS 安装包，`npm run dist:portable` 生成便携版。

### 隐私

日志和诊断报告会过滤 API Key、Token、Authorization 等敏感信息，且不包含用户对话正文。详见 `SECURITY.md`。

## English

A lightweight Windows desktop wrapper for [DeepSeek Harness](https://github.com/deepseek-ai). It starts `dsh web` locally and shows the **unmodified** Harness UI. It does not reimplement conversations, plugins, or model settings.

Harness remains a DeepSeek project. This wrapper is not an official DeepSeek product.

### What the desktop shell does

- Detects Node.js, npm, and `@deepseek-ai/dsh`
- Offers **automatic**, **manual**, or **later** setup when something is missing
- Starts Harness on a loopback port (`127.0.0.1`) without opening a browser
- Adds a thin status bar, tray, autostart, logs, and desktop updates

Closing the window hides to the tray by default. Use **Quit** in the tray to fully exit.

### Setup choices

On first launch, if a dependency is missing, the wizard offers:

1. **Automatic install**: shows source, version, and command, then runs only after you confirm. Node.js uses Windows Package Manager (`winget`) package `OpenJS.NodeJS.LTS`; `dsh` uses the official npm package `@deepseek-ai/dsh`.
2. **Manual install**: shows official links and copyable commands. Click **Recheck** when you are done.
3. **Later**: enters a restricted mode with diagnostics and desktop settings only.

Updates are also confirmation-gated. Nothing installs silently.

### Installers

Windows setup and portable builds are published on [GitHub Releases](https://github.com/AOwangjian/deepseek-harness-desktop/releases).

Unsigned first-run builds may trigger SmartScreen ("unknown publisher"). That is expected until a trusted code-signing certificate is configured.

Harness is local-only. LAN or remote access is not enabled by default.

### Development

Requires Node.js 22+.

```bash
npm install
npm run typecheck
npm test
npm run test:integration
npm run dev
```

Package locally:

```bash
npm run build
npm run test:e2e
npm run dist
npm run dist:portable
```

`npm run dist` builds the NSIS installer. `npm run dist:portable` builds the portable executable.

### Privacy

Logs and diagnostic reports redact secrets (API keys, tokens, Authorization headers) and omit conversation bodies. See `SECURITY.md`.
