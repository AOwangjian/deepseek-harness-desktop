import type { IpcMain } from 'electron';

import {
  confirmInstallRequestSchema,
  desktopIpcChannels,
  installRequestSchema,
  settingsSchema,
  type DesktopSnapshot,
  type InstallRequest,
  type DesktopSettings,
} from '../../shared/contracts';

export interface DesktopHost {
  getState(): DesktopSnapshot | Promise<DesktopSnapshot>;
  chooseInstallMode(request: InstallRequest): Promise<DesktopSnapshot>;
  confirmInstall(token: string): Promise<DesktopSnapshot>;
  start(): Promise<DesktopSnapshot>;
  stop(): Promise<DesktopSnapshot>;
  restart(): Promise<DesktopSnapshot>;
  getLogs(): readonly string[] | Promise<readonly string[]>;
  saveSettings(settings: DesktopSettings): Promise<DesktopSnapshot>;
  subscribe(listener: (snapshot: DesktopSnapshot) => void): () => void;
}

export const DESKTOP_IPC_HANDLER_CHANNELS = [
  desktopIpcChannels.getState,
  desktopIpcChannels.chooseInstallMode,
  desktopIpcChannels.confirmInstall,
  desktopIpcChannels.start,
  desktopIpcChannels.stop,
  desktopIpcChannels.restart,
  desktopIpcChannels.getLogs,
  desktopIpcChannels.saveSettings,
] as const;

export function registerIpc(
  ipcMain: Pick<IpcMain, 'handle'>,
  host: DesktopHost,
  broadcast: (snapshot: DesktopSnapshot) => void,
): () => void {
  const unsubscribe = host.subscribe((snapshot) => {
    broadcast(snapshot);
  });

  ipcMain.handle(desktopIpcChannels.getState, async () => host.getState());
  ipcMain.handle(desktopIpcChannels.chooseInstallMode, async (_event, payload: unknown) =>
    host.chooseInstallMode(installRequestSchema.parse(payload)),
  );
  ipcMain.handle(desktopIpcChannels.confirmInstall, async (_event, payload: unknown) => {
    const request = confirmInstallRequestSchema.parse(payload);
    return host.confirmInstall(request.token);
  });
  ipcMain.handle(desktopIpcChannels.start, async () => host.start());
  ipcMain.handle(desktopIpcChannels.stop, async () => host.stop());
  ipcMain.handle(desktopIpcChannels.restart, async () => host.restart());
  ipcMain.handle(desktopIpcChannels.getLogs, async () => host.getLogs());
  ipcMain.handle(desktopIpcChannels.saveSettings, async (_event, payload: unknown) =>
    host.saveSettings(settingsSchema.parse(payload)),
  );

  return unsubscribe;
}
