import { app, BrowserWindow } from 'electron';
import path from 'node:path';

import {
  createWindowOptions,
  loadRenderer,
  resolveRendererTarget,
} from './window';

const createWindow = (): BrowserWindow => {
  const rendererPath = path.join(__dirname, '../renderer/index.html');
  const window = new BrowserWindow(
    createWindowOptions(path.join(__dirname, '../preload/index.js')),
  );
  const rendererTarget = resolveRendererTarget({
    isPackaged: app.isPackaged,
    rendererPath,
    rendererUrl: process.env.ELECTRON_RENDERER_URL,
  });

  void loadRenderer(rendererTarget, window);

  return window;
};

app.whenReady().then(() => {
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
