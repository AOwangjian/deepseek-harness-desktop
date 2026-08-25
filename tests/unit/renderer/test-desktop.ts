import { vi } from 'vitest';

import type { DesktopPreloadApi } from '../../../src/preload/index';
import type { DesktopSnapshot } from '../../../src/shared/contracts';

export const readyDependencies = {
  node: { name: 'node' as const, present: true, version: '22.0.0' },
  npm: { name: 'npm' as const, present: true, version: '11.0.0' },
  dsh: { name: 'dsh' as const, present: true, version: '0.1.0' },
  ready: true,
};

export function setupSnapshot(
  overrides: Partial<DesktopSnapshot> = {},
): DesktopSnapshot {
  return {
    surface: 'setup',
    runtime: { status: 'needs-setup', missing: ['node', 'dsh'] },
    dependencies: {
      node: { name: 'node', present: false },
      npm: { name: 'npm', present: false },
      dsh: { name: 'dsh', present: false },
      ready: false,
    },
    settings: { closeToTray: true, autoStart: false, updatePolicy: 'notify' },
    installPlan: null,
    confirmationToken: null,
    logs: [],
    ...overrides,
  };
}

export function mockDesktop(snapshot: DesktopSnapshot): DesktopPreloadApi {
  const api: DesktopPreloadApi = {
    getState: vi.fn(async () => snapshot),
    chooseInstallMode: vi.fn(async () => snapshot),
    confirmInstall: vi.fn(async () => snapshot),
    start: vi.fn(async () => snapshot),
    stop: vi.fn(async () => snapshot),
    restart: vi.fn(async () => snapshot),
    getLogs: vi.fn(async () => snapshot.logs),
    saveSettings: vi.fn(async () => snapshot),
    subscribeState: vi.fn(() => () => undefined),
  };
  window.desktop = api;
  return api;
}
