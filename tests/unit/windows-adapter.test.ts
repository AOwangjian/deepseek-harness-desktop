import { describe, expect, it, vi } from 'vitest';

import type { ProcessRecord } from '../../src/main/harness/process-record-store';
import { UnownedProcessError } from '../../src/main/platform/platform-adapter';
import { WindowsAdapter } from '../../src/main/platform/windows-adapter';

const record: ProcessRecord = {
  version: 1,
  pid: 4_321,
  startedAt: '2026-08-25T01:02:03.000Z',
  instanceId: 'desktop-session-1',
  port: 18_765,
  executable: 'C:\\Program Files\\nodejs\\dsh.cmd',
};

describe('WindowsAdapter', () => {
  it('delegates autostart to app.setLoginItemSettings', () => {
    const app = {
      setLoginItemSettings: vi.fn(),
      getLoginItemSettings: vi.fn(() => ({ openAtLogin: true })),
    };
    const adapter = new WindowsAdapter({
      app,
      inspectProcess: vi.fn(),
      terminateTree: vi.fn(),
      notify: vi.fn(),
      openPath: vi.fn(),
    });

    adapter.setAutoStart(true);
    expect(app.setLoginItemSettings).toHaveBeenCalledExactlyOnceWith({
      openAtLogin: true,
    });
    expect(adapter.getAutoStart()).toBe(true);
  });

  it('terminates only after verifying executable and creation time', async () => {
    const terminateTree = vi.fn(async () => undefined);
    const adapter = new WindowsAdapter({
      app: {
        setLoginItemSettings: vi.fn(),
        getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
      },
      inspectProcess: vi.fn(async () => ({
        executable: record.executable,
        startedAt: record.startedAt,
      })),
      terminateTree,
      notify: vi.fn(),
      openPath: vi.fn(),
    });

    await adapter.terminateOwnedProcessTree(record);
    expect(terminateTree).toHaveBeenCalledExactlyOnceWith(record.pid);
  });

  it('refuses unowned PID records', async () => {
    const terminateTree = vi.fn(async () => undefined);
    const adapter = new WindowsAdapter({
      app: {
        setLoginItemSettings: vi.fn(),
        getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
      },
      inspectProcess: vi.fn(async () => ({
        executable: 'C:\\Windows\\System32\\notepad.exe',
        startedAt: record.startedAt,
      })),
      terminateTree,
      notify: vi.fn(),
      openPath: vi.fn(),
    });

    await expect(adapter.terminateOwnedProcessTree(record)).rejects.toBeInstanceOf(
      UnownedProcessError,
    );
    expect(terminateTree).not.toHaveBeenCalled();
  });
});
