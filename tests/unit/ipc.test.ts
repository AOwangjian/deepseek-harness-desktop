import { describe, expect, it, vi } from 'vitest';

import { registerIpc, type DesktopHost } from '../../src/main/ipc/register-ipc';
import {
  desktopIpcChannels,
  type DesktopSettings,
  type DesktopSnapshot,
  type InstallRequest,
} from '../../src/shared/contracts';

const emptyDependencies = {
  node: { name: 'node' as const, present: true, version: '22.0.0' },
  npm: { name: 'npm' as const, present: true, version: '11.0.0' },
  dsh: { name: 'dsh' as const, present: true, version: '1.0.0' },
  ready: true,
};

const snapshot: DesktopSnapshot = {
  surface: 'setup',
  runtime: { status: 'needs-setup', missing: ['dsh'] },
  dependencies: emptyDependencies,
  settings: { closeToTray: true, autoStart: false, updatePolicy: 'notify' },
  installPlan: null,
  confirmationToken: null,
  logs: [],
};

function createHost(overrides: Partial<DesktopHost> = {}) {
  const subscribe = vi.fn((listener: (next: DesktopSnapshot) => void) => {
    listener(snapshot);
    return () => undefined;
  });
  const host: DesktopHost = {
    getState: vi.fn(async () => snapshot),
    chooseInstallMode: vi.fn(async () => snapshot),
    confirmInstall: vi.fn(async () => snapshot),
    start: vi.fn(async () => snapshot),
    stop: vi.fn(async () => snapshot),
    restart: vi.fn(async () => snapshot),
    getLogs: vi.fn(async () => ['READY']),
    saveSettings: vi.fn(async () => snapshot),
    subscribe,
    ...overrides,
  };
  return host;
}

function createIpcMain() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    handlers,
    handle: vi.fn((channel: string, listener: (...args: unknown[]) => unknown) => {
      handlers.set(channel, listener);
    }),
    invoke(channel: string, payload?: unknown) {
      const handler = handlers.get(channel);
      if (handler === undefined) throw new Error(`missing handler ${channel}`);
      return handler({}, payload);
    },
  };
}

describe('desktop IPC', () => {
  it('registers only the allowlisted mutation and query channels', () => {
    const ipcMain = createIpcMain();
    const host = createHost();
    const broadcast = vi.fn();

    registerIpc(ipcMain, host, broadcast);

    expect([...ipcMain.handlers.keys()].sort()).toEqual([
      desktopIpcChannels.chooseInstallMode,
      desktopIpcChannels.confirmInstall,
      desktopIpcChannels.getLogs,
      desktopIpcChannels.getState,
      desktopIpcChannels.restart,
      desktopIpcChannels.saveSettings,
      desktopIpcChannels.start,
      desktopIpcChannels.stop,
    ].sort());
    expect([...ipcMain.handlers.keys()].join(' ')).not.toMatch(/exec|command|shell/i);
    expect(broadcast).toHaveBeenCalledExactlyOnceWith(snapshot);
  });

  it('parses install and settings payloads with Zod and rejects extras', async () => {
    const ipcMain = createIpcMain();
    const host = createHost();
    registerIpc(ipcMain, host, vi.fn());

    const request: InstallRequest = { dependency: 'dsh', mode: 'automatic' };
    await ipcMain.invoke(desktopIpcChannels.chooseInstallMode, request);
    expect(host.chooseInstallMode).toHaveBeenCalledExactlyOnceWith(request);

    await expect(
      ipcMain.invoke(desktopIpcChannels.chooseInstallMode, {
        dependency: 'dsh',
        mode: 'automatic',
        extra: true,
      }),
    ).rejects.toThrow();

    await expect(
      ipcMain.invoke(desktopIpcChannels.chooseInstallMode, {
        dependency: 'evil-package',
        mode: 'automatic',
      }),
    ).rejects.toThrow();

    await ipcMain.invoke(desktopIpcChannels.confirmInstall, { token: 'one-use-token' });
    expect(host.confirmInstall).toHaveBeenCalledExactlyOnceWith('one-use-token');

    const settings: DesktopSettings = {
      closeToTray: false,
      autoStart: true,
      updatePolicy: 'manual',
    };
    await ipcMain.invoke(desktopIpcChannels.saveSettings, settings);
    expect(host.saveSettings).toHaveBeenCalledExactlyOnceWith(settings);

    await expect(
      ipcMain.invoke(desktopIpcChannels.saveSettings, {
        ...settings,
        command: 'rm -rf /',
      }),
    ).rejects.toThrow();
  });

  it('does not expose a generic command-execution method', () => {
    const source = [
      desktopIpcChannels.getState,
      desktopIpcChannels.chooseInstallMode,
      desktopIpcChannels.confirmInstall,
      desktopIpcChannels.start,
      desktopIpcChannels.stop,
      desktopIpcChannels.restart,
      desktopIpcChannels.getLogs,
      desktopIpcChannels.saveSettings,
    ];
    expect(source.some((channel) => /exec|spawn|shell|command/i.test(channel))).toBe(
      false,
    );
  });
});
