import { app, BrowserWindow, ipcMain, shell, WebContentsView } from 'electron';
import path from 'node:path';

import { registerIpc, type DesktopHost } from './ipc/register-ipc';
import { applyHarnessNavigationPolicy } from './security/navigation-policy';
import {
  desktopIpcChannels,
  type DependencySnapshot,
  type DesktopSnapshot,
} from '../shared/contracts';
import {
  createHarnessViewOptions,
  createWindowOptions,
  harnessViewBounds,
  loadRenderer,
  resolveRendererTarget,
} from './window';

let harnessPort: number | null = null;

function placeholderDependencies(): DependencySnapshot {
  return {
    node: { name: 'node', present: false },
    npm: { name: 'npm', present: false },
    dsh: { name: 'dsh', present: false },
    ready: false,
  };
}

function placeholderSnapshot(): DesktopSnapshot {
  return {
    surface: 'setup',
    runtime: { status: 'needs-setup', missing: ['node', 'dsh'] },
    dependencies: placeholderDependencies(),
    settings: { closeToTray: true, autoStart: false, updatePolicy: 'notify' },
    installPlan: null,
    confirmationToken: null,
    logs: [],
  };
}

function createPlaceholderHost(): DesktopHost {
  const snapshot = placeholderSnapshot();
  return {
    getState: async () => snapshot,
    chooseInstallMode: async () => snapshot,
    confirmInstall: async () => snapshot,
    start: async () => snapshot,
    stop: async () => snapshot,
    restart: async () => snapshot,
    getLogs: async () => snapshot.logs,
    saveSettings: async () => snapshot,
    subscribe: (listener) => {
      listener(snapshot);
      return () => undefined;
    },
  };
}

const createWindow = (): BrowserWindow => {
  const rendererPath = path.join(__dirname, '../renderer/index.html');
  const window = new BrowserWindow(
    createWindowOptions(path.join(__dirname, '../preload/index.js')),
  );
  const harnessView = new WebContentsView(createHarnessViewOptions());
  applyHarnessNavigationPolicy(
    harnessView.webContents,
    () => harnessPort,
    (url) => shell.openExternal(url),
  );
  window.contentView.addChildView(harnessView);

  const layoutHarnessView = (): void => {
    harnessView.setBounds(harnessViewBounds(window.getContentBounds()));
  };
  window.on('resize', layoutHarnessView);
  layoutHarnessView();

  const rendererTarget = resolveRendererTarget({
    isPackaged: app.isPackaged,
    rendererPath,
    rendererUrl: process.env.ELECTRON_RENDERER_URL,
  });

  void loadRenderer(rendererTarget, window);

  return window;
};

app.whenReady().then(() => {
  registerIpc(ipcMain, createPlaceholderHost(), (snapshot) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(desktopIpcChannels.stateEvent, snapshot);
    }
  });
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
