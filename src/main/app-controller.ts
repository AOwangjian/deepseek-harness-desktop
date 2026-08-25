import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { settingsSchema } from '../shared/contracts';
import type { DesktopHost } from './ipc/register-ipc';
import type { DiagnosticService } from './diagnostics/diagnostic-service';
import type { HarnessSupervisor } from './harness/harness-supervisor';
import {
  createInstallPlan,
  executeInstallPlan,
  type ConfirmationTokenIssuer,
  type InstallPlan,
} from './harness/dependency-installer';
import type { ProcessRecordStore } from './harness/process-record-store';
import type { PlatformAdapter } from './platform/platform-adapter';
import {
  type DependencyName,
  type DependencySnapshot,
  type DesktopSettings,
  type DesktopPanel,
  type DesktopSnapshot,
  type DesktopSurface,
  type HarnessRuntime,
  type InstallRequest,
} from '../shared/contracts';

export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = {
  closeToTray: true,
  autoStart: false,
  updatePolicy: 'notify',
};

export interface SettingsStore {
  load(): Promise<DesktopSettings>;
  save(settings: DesktopSettings): Promise<void>;
}

export interface AppControllerOptions {
  readonly detect: () => Promise<DependencySnapshot>;
  readonly supervisor: HarnessSupervisor;
  readonly diagnostics: DiagnosticService;
  readonly platform: PlatformAdapter;
  readonly recordStore: ProcessRecordStore;
  readonly tokens: ConfirmationTokenIssuer;
  readonly settingsStore: SettingsStore;
  readonly executeInstall?: typeof executeInstallPlan;
  readonly now?: () => string;
}

function missingDependencies(snapshot: DependencySnapshot): DependencyName[] {
  const missing: DependencyName[] = [];
  if (!snapshot.node.present || snapshot.node.version === undefined) missing.push('node');
  if (!snapshot.dsh.present || snapshot.dsh.version === undefined) missing.push('dsh');
  return missing;
}

function surfaceFor(runtime: HarnessRuntime, restricted: boolean): DesktopSurface {
  if (restricted || runtime.status === 'needs-setup') return 'setup';
  if (runtime.status === 'failed') return 'diagnostics';
  if (runtime.status === 'running') return 'running';
  return 'starting';
}

export class AppController implements DesktopHost {
  private readonly detect: () => Promise<DependencySnapshot>;
  private readonly supervisor: HarnessSupervisor;
  private readonly diagnostics: DiagnosticService;
  private readonly platform: PlatformAdapter;
  private readonly recordStore: ProcessRecordStore;
  private readonly tokens: ConfirmationTokenIssuer;
  private readonly settingsStore: SettingsStore;
  private readonly executeInstall: typeof executeInstallPlan;
  private readonly now: () => string;
  private snapshot: DesktopSnapshot;
  private dependencies: DependencySnapshot;
  private settings: DesktopSettings = DEFAULT_DESKTOP_SETTINGS;
  private restricted = false;
  private panel: DesktopPanel = 'none';
  private pendingPlan: InstallPlan | null = null;
  private readonly snapshotListeners = new Set<(snapshot: DesktopSnapshot) => void>();

  constructor(options: AppControllerOptions) {
    this.detect = options.detect;
    this.supervisor = options.supervisor;
    this.diagnostics = options.diagnostics;
    this.platform = options.platform;
    this.recordStore = options.recordStore;
    this.tokens = options.tokens;
    this.settingsStore = options.settingsStore;
    this.executeInstall = options.executeInstall ?? executeInstallPlan;
    this.now = options.now ?? (() => new Date().toISOString());
    this.dependencies = {
      node: { name: 'node', present: false },
      npm: { name: 'npm', present: false },
      dsh: { name: 'dsh', present: false },
      ready: false,
    };
    this.snapshot = this.buildSnapshot({ status: 'checking' });
    this.supervisor.on('snapshot', (runtime) => {
      const decorated = this.decorateRuntime(runtime);
      if (decorated.status !== 'running') this.panel = 'none';
      this.publish(this.buildSnapshot(decorated));
    });
  }

  async bootstrap(): Promise<DesktopSnapshot> {
    this.settings = await this.settingsStore.load();
    this.platform.setAutoStart(this.settings.autoStart);
    await this.recoverOrphan();
    this.dependencies = await this.detect();
    if (!this.dependencies.ready) {
      return this.publish(
        this.buildSnapshot({
          status: 'needs-setup',
          missing: missingDependencies(this.dependencies),
        }),
      );
    }
    await this.supervisor.start();
    return this.snapshot;
  }

  getState(): DesktopSnapshot {
    return this.snapshot;
  }

  async chooseInstallMode(request: InstallRequest): Promise<DesktopSnapshot> {
    if (request.mode === 'later' || request.mode === 'manual') {
      this.restricted = true;
      this.pendingPlan = null;
      return this.publish(
        this.buildSnapshot({
          status: 'needs-setup',
          missing: missingDependencies(this.dependencies),
        }),
      );
    }

    const version =
      request.dependency === 'node'
        ? (this.dependencies.node.version ?? '22.0.0')
        : (this.dependencies.dsh.version ?? '0.0.0');
    const plan = createInstallPlan(request, version);
    if (plan === null) {
      return this.snapshot;
    }
    this.pendingPlan = plan;
    const confirmationToken = this.tokens.issue(plan);
    return this.publish(this.buildSnapshot(this.snapshot.runtime, plan, confirmationToken));
  }

  async confirmInstall(token: string): Promise<DesktopSnapshot> {
    if (this.pendingPlan === null) {
      return this.snapshot;
    }
    const plan = this.pendingPlan;
    this.pendingPlan = null;
    try {
      await this.executeInstall(plan, token, this.tokens);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Installation failed.';
      this.diagnostics.append(message);
      return this.publish(this.buildSnapshot({ status: 'failed', error: message }));
    }
    this.dependencies = await this.detect();
    if (!this.dependencies.ready) {
      return this.publish(
        this.buildSnapshot({
          status: 'needs-setup',
          missing: missingDependencies(this.dependencies),
        }),
      );
    }
    this.restricted = false;
    await this.supervisor.start();
    return this.snapshot;
  }

  start(): Promise<DesktopSnapshot> {
    return this.supervisor.start().then(() => this.snapshot);
  }

  stop(): Promise<DesktopSnapshot> {
    return this.supervisor.stop().then(() => this.snapshot);
  }

  restart(): Promise<DesktopSnapshot> {
    return this.supervisor.restart().then(() => this.snapshot);
  }

  getLogs(): readonly string[] {
    return this.diagnostics.recentLogs();
  }

  setPanel(panel: DesktopPanel): DesktopSnapshot {
    this.panel = panel;
    return this.publish(this.buildSnapshot(this.snapshot.runtime));
  }

  async saveSettings(settings: DesktopSettings): Promise<DesktopSnapshot> {
    this.settings = settings;
    await this.settingsStore.save(settings);
    this.platform.setAutoStart(settings.autoStart);
    return this.publish(this.buildSnapshot(this.snapshot.runtime));
  }

  subscribe(listener: (snapshot: DesktopSnapshot) => void): () => void {
    this.snapshotListeners.add(listener);
    listener(this.snapshot);
    return () => {
      this.snapshotListeners.delete(listener);
    };
  }

  async quit(): Promise<void> {
    await this.supervisor.stop();
  }

  private decorateRuntime(runtime: HarnessRuntime): HarnessRuntime {
    if (runtime.status === 'checking' && !this.dependencies.ready) {
      return {
        status: 'needs-setup',
        missing: missingDependencies(this.dependencies),
      };
    }
    return runtime;
  }

  private async recoverOrphan(): Promise<void> {
    const record = await this.recordStore.read();
    if (record === null) return;
    try {
      await this.platform.terminateOwnedProcessTree(record);
    } catch {
      this.diagnostics.append('Owned process recovery refused an unowned record.');
    }
    await this.recordStore.deleteIfOwned(record.instanceId);
  }

  private buildSnapshot(
    runtime: HarnessRuntime,
    installPlan: InstallPlan | null = this.pendingPlan,
    confirmationToken: string | null = null,
  ): DesktopSnapshot {
    const error = runtime.status === 'failed' ? runtime.error : undefined;
    return Object.freeze({
      surface: surfaceFor(runtime, this.restricted),
      panel: this.panel,
      runtime,
      dependencies: this.dependencies,
      settings: this.settings,
      installPlan:
        installPlan === null
          ? null
          : {
              executable: installPlan.executable,
              args: [...installPlan.args],
              source: installPlan.source,
              version: installPlan.version,
            },
      confirmationToken,
      logs: this.diagnostics.recentLogs(),
      ...(error === undefined ? {} : { error }),
    });
  }

  private publish(snapshot: DesktopSnapshot): DesktopSnapshot {
    this.snapshot = snapshot;
    for (const listener of this.snapshotListeners) {
      try {
        listener(snapshot);
      } catch {
        // Renderer subscribers must not affect controller state.
      }
    }
    return snapshot;
  }
}

export function createMemorySettingsStore(
  initial: DesktopSettings = DEFAULT_DESKTOP_SETTINGS,
): SettingsStore {
  let settings = initial;
  return {
    load: async () => settings,
    save: async (next) => {
      settings = next;
    },
  };
}

export function createFileSettingsStore(filePath: string): SettingsStore {
  return {
    async load(): Promise<DesktopSettings> {
      try {
        return settingsSchema.parse(JSON.parse(await readFile(filePath, 'utf8')));
      } catch {
        return DEFAULT_DESKTOP_SETTINGS;
      }
    },
    async save(settings: DesktopSettings): Promise<void> {
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
    },
  };
}
