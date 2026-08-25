import { contextBridge, ipcRenderer } from 'electron';

import {
  desktopIpcChannels,
  type DesktopSettings,
  type DesktopSnapshot,
  type InstallRequest,
} from '../shared/contracts';

export interface DesktopPreloadApi {
  getState(): Promise<DesktopSnapshot>;
  chooseInstallMode(request: InstallRequest): Promise<DesktopSnapshot>;
  confirmInstall(token: string): Promise<DesktopSnapshot>;
  start(): Promise<DesktopSnapshot>;
  stop(): Promise<DesktopSnapshot>;
  restart(): Promise<DesktopSnapshot>;
  getLogs(): Promise<readonly string[]>;
  saveSettings(settings: DesktopSettings): Promise<DesktopSnapshot>;
  subscribeState(listener: (snapshot: DesktopSnapshot) => void): () => void;
}

const desktopApi: DesktopPreloadApi = {
  getState: () => ipcRenderer.invoke(desktopIpcChannels.getState),
  chooseInstallMode: (request) =>
    ipcRenderer.invoke(desktopIpcChannels.chooseInstallMode, request),
  confirmInstall: (token) =>
    ipcRenderer.invoke(desktopIpcChannels.confirmInstall, { token }),
  start: () => ipcRenderer.invoke(desktopIpcChannels.start),
  stop: () => ipcRenderer.invoke(desktopIpcChannels.stop),
  restart: () => ipcRenderer.invoke(desktopIpcChannels.restart),
  getLogs: () => ipcRenderer.invoke(desktopIpcChannels.getLogs),
  saveSettings: (settings) =>
    ipcRenderer.invoke(desktopIpcChannels.saveSettings, settings),
  subscribeState: (listener) => {
    const wrapped = (_event: unknown, snapshot: DesktopSnapshot): void => {
      listener(snapshot);
    };
    ipcRenderer.on(desktopIpcChannels.stateEvent, wrapped);
    return () => {
      ipcRenderer.removeListener(desktopIpcChannels.stateEvent, wrapped);
    };
  },
};

contextBridge.exposeInMainWorld('desktop', desktopApi);
