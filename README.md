# DeepSeek Harness Desktop

A lightweight Windows desktop wrapper for [DeepSeek Harness](https://github.com/deepseek-ai). It starts `dsh web` locally and shows the **unmodified** Harness UI. It does not reimplement conversations, plugins, or model settings.

## What the desktop shell does

- Detects Node.js, npm, and `@deepseek-ai/dsh`
- Offers **automatic**, **manual**, or **later** setup when something is missing
- Starts Harness on a loopback port (`127.0.0.1`) without opening a browser
- Adds a thin status bar, tray, autostart, logs, and desktop updates

Closing the window hides to the tray by default. Use **Quit** in the tray to fully exit.

## Install

Windows installers and a portable build are published on GitHub Releases.

First-run unsigned builds may trigger SmartScreen ("unknown publisher"). That is expected until a code-signing certificate is configured.

Harness remains a DeepSeek project. This wrapper is not an official DeepSeek product.

## Development

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

## Privacy

Logs and diagnostic reports redact secrets and omit conversation bodies. See `SECURITY.md`.
