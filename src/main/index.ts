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
import {
  createHarnessViewOptions,
  createWindowOptions,
  harnessViewBounds,
  loadRenderer,
  resolveRendererTarget,
} from './window';

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  let mainWindow: BrowserWindow | undefined;
  let harnessView: WebContentsView | undefined;
  let controller: AppController | undefined;
  let quitting = false;

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
    });
    harnessProcess.on('log', (event) => {
      diagnostics.append(event.line);
    });
    const supervisor = new HarnessSupervisor({ process: harnessProcess });
    controller = new AppController({
      detect: detectDependencies,
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
      if (snapshot.runtime.status === 'running') {
        void harnessView.webContents.loadURL(snapshot.runtime.url);
        harnessView.setVisible(true);
      } else {
        harnessView.setVisible(false);
      }
    });

    const tray = new Tray(nativeImage.createEmpty());
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
        },
        openSettings: restoreWindow,
        quit: () => {
          quitting = true;
          app.quit();
        },
      },
      APP_NAME,
    );

    mainWindow.on('close', (event) => {
      if (quitting) return;
      const closeToTray = controller?.getState().settings.closeToTray ?? true;
      handleWindowClose(event, mainWindow!, closeToTray);
    });

    const rendererTarget = resolveRendererTarget({
      isPackaged: app.isPackaged,
      rendererPath: path.join(__dirname, '../renderer/index.html'),
      rendererUrl: process.env.ELECTRON_RENDERER_URL,
    });
    void loadRenderer(rendererTarget, mainWindow);
    await controller.bootstrap();
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
