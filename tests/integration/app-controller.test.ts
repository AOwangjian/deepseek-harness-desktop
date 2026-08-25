import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import {
  AppController,
  createMemorySettingsStore,
} from '../../src/main/app-controller';
import { DiagnosticService } from '../../src/main/diagnostics/diagnostic-service';
import { ConfirmationTokenIssuer } from '../../src/main/harness/dependency-installer';
import type { HarnessRuntime } from '../../src/shared/contracts';
import type { ProcessRecord } from '../../src/main/harness/process-record-store';

const readyDependencies = {
  node: { name: 'node' as const, present: true, version: '22.0.0', executablePath: 'node' },
  npm: { name: 'npm' as const, present: true, version: '11.0.0', executablePath: 'npm' },
  dsh: { name: 'dsh' as const, present: true, version: '1.2.3', executablePath: 'dsh' },
  ready: true,
};

const missingDependencies = {
  node: { name: 'node' as const, present: true, version: '22.0.0', executablePath: 'node' },
  npm: { name: 'npm' as const, present: true, version: '11.0.0', executablePath: 'npm' },
  dsh: { name: 'dsh' as const, present: false },
  ready: false,
};

class FakeSupervisor extends EventEmitter {
  snapshot: HarnessRuntime = { status: 'checking' };

  getSnapshot(): HarnessRuntime {
    return this.snapshot;
  }

  async start(): Promise<HarnessRuntime> {
    this.snapshot = {
      status: 'running',
      pid: 4_321,
      port: 18_765,
      url: 'http://127.0.0.1:18765',
    };
    this.emit('snapshot', this.snapshot);
    return this.snapshot;
  }

  async stop(): Promise<HarnessRuntime> {
    this.snapshot = { status: 'checking' };
    this.emit('snapshot', this.snapshot);
    return this.snapshot;
  }

  async restart(): Promise<HarnessRuntime> {
    await this.stop();
    return this.start();
  }

  crash(): void {
    this.snapshot = { status: 'failed', error: 'Harness process exited unexpectedly.' };
    this.emit('snapshot', this.snapshot);
  }
}

function memoryRecordStore(initial: ProcessRecord | null = null) {
  let record = initial;
  return {
    read: async () => record,
    write: async (next: ProcessRecord) => {
      record = next;
    },
    deleteIfOwned: async (instanceId: string) => {
      if (record?.instanceId !== instanceId) return false;
      record = null;
      return true;
    },
    getRecord: () => record,
  };
}

function createPlatform() {
  return {
    setAutoStart: vi.fn(),
    getAutoStart: vi.fn(() => false),
    terminateOwnedProcessTree: vi.fn(async () => undefined),
    showNotification: vi.fn(),
    openPath: vi.fn(async () => undefined),
  };
}

describe('AppController', () => {
  it('starts the UI when dependencies are ready', async () => {
    const supervisor = new FakeSupervisor();
    const controller = new AppController({
      detect: async () => readyDependencies,
      supervisor: supervisor as never,
      diagnostics: new DiagnosticService(),
      platform: createPlatform(),
      recordStore: memoryRecordStore() as never,
      tokens: new ConfirmationTokenIssuer(),
      settingsStore: createMemorySettingsStore(),
    });

    const snapshot = await controller.bootstrap();
    expect(snapshot.surface).toBe('running');
    expect(snapshot.runtime.status).toBe('running');
  });

  it('enters restricted setup when the user declines installation', async () => {
    const executeInstall = vi.fn();
    const supervisor = new FakeSupervisor();
    const start = vi.spyOn(supervisor, 'start');
    const controller = new AppController({
      detect: async () => missingDependencies,
      supervisor: supervisor as never,
      diagnostics: new DiagnosticService(),
      platform: createPlatform(),
      recordStore: memoryRecordStore() as never,
      tokens: new ConfirmationTokenIssuer(),
      settingsStore: createMemorySettingsStore(),
      executeInstall,
    });

    await controller.bootstrap();
    const declined = await controller.chooseInstallMode({
      dependency: 'dsh',
      mode: 'later',
    });

    expect(declined.surface).toBe('setup');
    expect(executeInstall).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  it('rechecks and runs after an accepted install', async () => {
    let ready = false;
    const executeInstall = vi.fn(async () => ({
      exitCode: 0,
      progressEvents: [],
      progressTruncated: false,
    }));
    const controller = new AppController({
      detect: async () => (ready ? readyDependencies : missingDependencies),
      supervisor: new FakeSupervisor() as never,
      diagnostics: new DiagnosticService(),
      platform: createPlatform(),
      recordStore: memoryRecordStore() as never,
      tokens: new ConfirmationTokenIssuer(),
      settingsStore: createMemorySettingsStore(),
      executeInstall,
    });

    await controller.bootstrap();
    const planned = await controller.chooseInstallMode({
      dependency: 'dsh',
      mode: 'automatic',
    });
    expect(planned.installPlan?.source).toBe('npmjs.org');
    expect(planned.confirmationToken).toEqual(expect.any(String));
    ready = true;
    const running = await controller.confirmInstall(planned.confirmationToken ?? '');
    expect(executeInstall).toHaveBeenCalledOnce();
    expect(running.surface).toBe('running');
  });

  it('moves to diagnostics after a service crash', async () => {
    const supervisor = new FakeSupervisor();
    const controller = new AppController({
      detect: async () => readyDependencies,
      supervisor: supervisor as never,
      diagnostics: new DiagnosticService(),
      platform: createPlatform(),
      recordStore: memoryRecordStore() as never,
      tokens: new ConfirmationTokenIssuer(),
      settingsStore: createMemorySettingsStore(),
    });
    await controller.bootstrap();
    supervisor.crash();
    expect(controller.getState().surface).toBe('diagnostics');
    expect(controller.getState().runtime.status).toBe('failed');
  });

  it('stops the child process on quit', async () => {
    const supervisor = new FakeSupervisor();
    const stop = vi.spyOn(supervisor, 'stop');
    const controller = new AppController({
      detect: async () => readyDependencies,
      supervisor: supervisor as never,
      diagnostics: new DiagnosticService(),
      platform: createPlatform(),
      recordStore: memoryRecordStore() as never,
      tokens: new ConfirmationTokenIssuer(),
      settingsStore: createMemorySettingsStore(),
    });
    await controller.bootstrap();
    await controller.quit();
    expect(stop).toHaveBeenCalledOnce();
  });

  it('recovers a verified orphan record at startup', async () => {
    const record: ProcessRecord = {
      version: 1,
      pid: 99,
      startedAt: '2026-08-25T01:02:03.000Z',
      instanceId: 'orphan-session',
      port: 18_765,
      executable: 'dsh',
    };
    const store = memoryRecordStore(record);
    const platform = createPlatform();
    const controller = new AppController({
      detect: async () => missingDependencies,
      supervisor: new FakeSupervisor() as never,
      diagnostics: new DiagnosticService(),
      platform,
      recordStore: store as never,
      tokens: new ConfirmationTokenIssuer(),
      settingsStore: createMemorySettingsStore(),
    });

    await controller.bootstrap();
    expect(platform.terminateOwnedProcessTree).toHaveBeenCalledExactlyOnceWith(record);
    expect(store.getRecord()).toBeNull();
  });
});
