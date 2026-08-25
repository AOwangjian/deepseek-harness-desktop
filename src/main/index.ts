import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  shell,
  Tray,
  WebContentsView,
} from 'electron';
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import { AppController, createFileSettingsStore } from './app-controller';
import { detectDependencies } from './harness/dependency-detector';
import { createConfirmationTokenIssuer } from './harness/dependency-installer';
import { HarnessProcess } from './harness/harness-process';
import { createAppProcessRecordStore } from './harness/process-record-store';
import { HarnessSupervisor } from './harness/harness-supervisor';
import { DiagnosticService } from './diagnostics/diagnostic-service';
import { registerIpc } from './ipc/register-ipc';
import { WindowsAdapter, defaultWindowsTerminateTree } from './platform/windows-adapter';
import { applyHarnessNavigationPolicy } from './security/navigation-policy';
import { handleWindowClose, TrayController } from './tray-controller';
import { desktopIpcChannels, APP_NAME } from '../shared/contracts';
import { resolveDesktopUserDataPath } from './single-instance';
import {
  createHarnessViewOptions,
  createWindowOptions,
  harnessViewBounds,
  loadRenderer,
  resolveRendererTarget,
} from './window';

app.setPath(
  'userData',
  resolveDesktopUserDataPath({
    override: process.env.DSH_DESKTOP_USER_DATA,
    appData: app.getPath('appData'),
  }),
);
app.disableHardwareAcceleration();

const fakeHarnessPath = process.env.DSH_DESKTOP_FAKE_HARNESS;

function logFatal(message: string, error?: unknown): void {
  const details =
    error instanceof Error
      ? error.stack ?? error.message
      : error === undefined
        ? ''
        : String(error);
  const line = `${new Date().toISOString()} ${message} ${details}\n`;
  try {
    const directory = app.getPath('userData');
    mkdirSync(directory, { recursive: true });
    appendFileSync(path.join(directory, 'desktop-error.log'), line, 'utf8');
  } catch {
    // Best-effort crash breadcrumb.
  }
  console.error(message, error);
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.exit(0);
} else {
  process.on('uncaughtException', (error) => {
    logFatal('uncaughtException', error);
  });
  process.on('unhandledRejection', (error) => {
    logFatal('unhandledRejection', error);
  });
  let mainWindow: BrowserWindow | undefined;
  let harnessView: WebContentsView | undefined;
  let controller: AppController | undefined;
  let quitting = false;
  let trayReady = false;

  const restoreWindow = (): void => {
    if (mainWindow === undefined) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  };

  app.on('second-instance', () => {
    restoreWindow();
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    const recordStore = createAppProcessRecordStore(app);
    const diagnostics = new DiagnosticService();
    const platform = new WindowsAdapter({
      app,
      inspectProcess: async () => null,
      terminateTree: defaultWindowsTerminateTree,
      notify: (title, body) => {
        new Notification({ title, body }).show();
      },
      openPath: async (target) => {
        await shell.openPath(target);
      },
    });
    const harnessProcess = new HarnessProcess({
      recordStore,
      terminateTree: (record) => platform.terminateOwnedProcessTree(record),
      ...(fakeHarnessPath === undefined
        ? {}
        : {
            executable: 'node',
            executableArgs: [fakeHarnessPath],
          }),
    });
    harnessProcess.on('log', (event) => {
      diagnostics.append(event.line);
    });
    const supervisor = new HarnessSupervisor({ process: harnessProcess });
    controller = new AppController({
      detect:
        fakeHarnessPath === undefined
          ? detectDependencies
          : async () => ({
              node: { name: 'node', present: true, version: process.versions.node, executablePath: process.execPath },
              npm: { name: 'npm', present: true, version: '11.0.0' },
              dsh: { name: 'dsh', present: true, version: '0.0.0-e2e', executablePath: process.execPath },
              ready: true,
            }),
      supervisor,
      diagnostics,
      platform,
      recordStore,
      tokens: createConfirmationTokenIssuer(),
      settingsStore: createFileSettingsStore(
        path.join(app.getPath('userData'), 'settings.json'),
      ),
    });

    mainWindow = new BrowserWindow(
      createWindowOptions(path.join(__dirname, '../preload/index.js')),
    );
    harnessView = new WebContentsView(createHarnessViewOptions());
    applyHarnessNavigationPolicy(
      harnessView.webContents,
      () => {
        const runtime = controller?.getState().runtime;
        return runtime?.status === 'running' ? runtime.port : null;
      },
      (url) => shell.openExternal(url),
    );
    mainWindow.contentView.addChildView(harnessView);
    const layoutHarnessView = (): void => {
      if (mainWindow === undefined || harnessView === undefined) return;
      harnessView.setBounds(harnessViewBounds(mainWindow.getContentBounds()));
    };
    mainWindow.on('resize', layoutHarnessView);
    layoutHarnessView();

    registerIpc(ipcMain, controller, (snapshot) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(desktopIpcChannels.stateEvent, snapshot);
      }
      if (harnessView === undefined) return;
      const showHarness =
        snapshot.runtime.status === 'running' && snapshot.panel === 'none';
      if (showHarness) {
        const currentUrl = harnessView.webContents.getURL();
        if (currentUrl !== snapshot.runtime.url) {
          void harnessView.webContents.loadURL(snapshot.runtime.url);
        }
        harnessView.setVisible(true);
      } else {
        harnessView.setVisible(false);
      }
    });

    try {
      let trayIcon = nativeImage.createFromPath(
        path.join(__dirname, '../../build/icon.ico'),
      );
      if (trayIcon.isEmpty()) {
        trayIcon = await app.getFileIcon(process.execPath, { size: 'small' });
      }
      if (!trayIcon.isEmpty()) {
        const tray = new Tray(trayIcon);
        trayReady = true;
        new TrayController(
          tray,
          { buildFromTemplate: (items) => Menu.buildFromTemplate([...items]) },
          {
            openWindow: restoreWindow,
            start: () => {
              void controller?.start();
            },
            stop: () => {
              void controller?.stop();
            },
            restart: () => {
              void controller?.restart();
            },
            showLogs: () => {
              restoreWindow();
              void controller?.setPanel('logs');
            },
            openSettings: () => {
              restoreWindow();
              void controller?.setPanel('settings');
            },
            quit: () => {
              quitting = true;
              app.quit();
            },
          },
          APP_NAME,
        );
      }
    } catch (error: unknown) {
      logFatal('tray setup failed', error);
    }

    mainWindow.on('close', (event) => {
      if (quitting) return;
      const closeToTray =
        trayReady && (controller?.getState().settings.closeToTray ?? true);
      handleWindowClose(event, mainWindow!, closeToTray);
    });

    const rendererTarget = resolveRendererTarget({
      isPackaged: app.isPackaged,
      rendererPath: path.join(__dirname, '../renderer/index.html'),
      rendererUrl: process.env.ELECTRON_RENDERER_URL,
    });
    void loadRenderer(rendererTarget, mainWindow);
    mainWindow.show();
    mainWindow.focus();
    try {
      await controller.bootstrap();
    } catch (error: unknown) {
      logFatal('bootstrap failed', error);
    }
  });

  app.on('before-quit', (event) => {
    if (quitting || controller === undefined) return;
    event.preventDefault();
    quitting = true;
    void controller.quit().finally(() => {
      app.quit();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && quitting) {
      app.quit();
    }
  });
}
