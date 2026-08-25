import { execa } from 'execa';
import path from 'node:path';

import type { ProcessRecord } from '../harness/process-record-store';
import {
  UnownedProcessError,
  type PlatformAdapter,
  type ProcessInspector,
  type ProcessTreeTerminator,
} from './platform-adapter';

const START_TIME_TOLERANCE_MS = 5_000;

export interface LoginItemApp {
  setLoginItemSettings(settings: { openAtLogin: boolean }): void;
  getLoginItemSettings(): { openAtLogin: boolean };
}

export interface WindowsAdapterOptions {
  readonly app: LoginItemApp;
  readonly inspectProcess: ProcessInspector;
  readonly terminateTree: ProcessTreeTerminator;
  readonly notify: (title: string, body: string) => void;
  readonly openPath: (target: string) => Promise<void>;
}

export async function defaultWindowsTerminateTree(pid: number): Promise<void> {
  await execa('taskkill', ['/PID', String(pid), '/T', '/F'], {
    shell: false,
    windowsHide: true,
    reject: false,
  });
}

function sameExecutable(recorded: string, live: string): boolean {
  return path.normalize(recorded).toLowerCase() === path.normalize(live).toLowerCase()
    || path.basename(recorded).toLowerCase() === path.basename(live).toLowerCase();
}

function sameStartTime(recorded: string, live: string): boolean {
  const recordedMs = Date.parse(recorded);
  const liveMs = Date.parse(live);
  if (Number.isNaN(recordedMs) || Number.isNaN(liveMs)) return false;
  return Math.abs(recordedMs - liveMs) <= START_TIME_TOLERANCE_MS;
}

export class WindowsAdapter implements PlatformAdapter {
  private readonly app: LoginItemApp;
  private readonly inspectProcess: ProcessInspector;
  private readonly terminateTree: ProcessTreeTerminator;
  private readonly notify: (title: string, body: string) => void;
  private readonly open: (target: string) => Promise<void>;

  constructor(options: WindowsAdapterOptions) {
    this.app = options.app;
    this.inspectProcess = options.inspectProcess;
    this.terminateTree = options.terminateTree;
    this.notify = options.notify;
    this.open = options.openPath;
  }

  setAutoStart(enabled: boolean): void {
    this.app.setLoginItemSettings({ openAtLogin: enabled });
  }

  getAutoStart(): boolean {
    return this.app.getLoginItemSettings().openAtLogin;
  }

  async terminateOwnedProcessTree(record: ProcessRecord): Promise<void> {
    const live = await this.inspectProcess(record.pid);
    if (live === null) return;
    if (!sameExecutable(record.executable, live.executable) || !sameStartTime(record.startedAt, live.startedAt)) {
      throw new UnownedProcessError();
    }
    await this.terminateTree(record.pid);
  }

  showNotification(title: string, body: string): void {
    this.notify(title, body);
  }

  openPath(target: string): Promise<void> {
    return this.open(target);
  }
}
