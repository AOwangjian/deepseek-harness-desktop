import { EventEmitter } from 'node:events';
import net from 'node:net';

import getPort from 'get-port';

import type { HarnessRuntime } from '../../shared/contracts';
import type { HarnessExitedEvent } from './harness-process';
import type { ProcessRecord } from './process-record-store';

export const LOOPBACK_HOST = '127.0.0.1';
export const READY_POLL_MS = 250;
export const STARTUP_TIMEOUT_MS = 20_000;
export const HEALTH_RETRY_DELAYS_MS = [1_000, 2_000, 4_000] as const;
export const MAX_START_FAILURES = 3;

export type PortSelector = (options: { host: string }) => Promise<number>;
export type HealthProbe = (url: string) => Promise<boolean>;
export type WaitFn = (milliseconds: number, signal?: AbortSignal) => Promise<void>;
export type NowFn = () => number;

export interface SupervisedProcess {
  start(port: number): Promise<ProcessRecord>;
  stop(): Promise<{ readonly status: string; readonly forced?: boolean }>;
  on(event: 'exited', listener: (event: HarnessExitedEvent) => void): unknown;
}

const ALLOWED_TRANSITIONS: Readonly<Record<string, ReadonlySet<string>>> = {
  checking: new Set(['starting']),
  starting: new Set(['running', 'failed', 'stopping']),
  running: new Set(['failed', 'stopping']),
  stopping: new Set(['checking']),
  failed: new Set(['starting']),
};

function listenForFreePort(host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, host, () => {
      const address = server.address();
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        if (address === null || typeof address === 'string') {
          reject(new Error('Failed to allocate a loopback port.'));
          return;
        }
        resolve(address.port);
      });
    });
  });
}

export async function defaultPortSelector(options: {
  host: string;
}): Promise<number> {
  try {
    return await Promise.race([
      getPort({ host: options.host }),
      new Promise<number>((_, reject) => {
        setTimeout(() => reject(new Error('get-port timed out')), 1_500);
      }),
    ]);
  } catch {
    return listenForFreePort(options.host);
  }
}

export async function defaultHealthProbe(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { redirect: 'manual' });
    return response.ok;
  } catch {
    return false;
  }
}

function defaultWait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, milliseconds);
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function freezeSnapshot(snapshot: HarnessRuntime): HarnessRuntime {
  return Object.freeze({ ...snapshot });
}

function harnessUrl(port: number): `http://127.0.0.1:${number}` {
  return `http://${LOOPBACK_HOST}:${port}`;
}

export interface HarnessSupervisorOptions {
  readonly process: SupervisedProcess;
  readonly getPort?: PortSelector;
  readonly probe?: HealthProbe;
  readonly wait?: WaitFn;
  readonly now?: NowFn;
}

export interface HarnessSupervisor {
  on(event: 'snapshot', listener: (snapshot: HarnessRuntime) => void): this;
}

/** Deterministic supervisor for one owned Harness process. */
export class HarnessSupervisor extends EventEmitter {
  private readonly process: SupervisedProcess;
  private readonly getPort: PortSelector;
  private readonly probe: HealthProbe;
  private readonly wait: WaitFn;
  private readonly now: NowFn;
  private snapshot: HarnessRuntime = freezeSnapshot({ status: 'checking' });
  private generation = 0;
  private abort = new AbortController();
  private consecutiveFailures = 0;
  private startOperation: Promise<HarnessRuntime> | null = null;
  private activeRecord: ProcessRecord | null = null;
  private readonly onExited = (event: HarnessExitedEvent): void => {
    void this.handleExit(event);
  };

  constructor(options: HarnessSupervisorOptions) {
    super();
    this.process = options.process;
    this.getPort = options.getPort ?? defaultPortSelector;
    this.probe = options.probe ?? defaultHealthProbe;
    this.wait = options.wait ?? defaultWait;
    this.now = options.now ?? Date.now;
    this.process.on('exited', this.onExited);
  }

  getSnapshot(): HarnessRuntime {
    return this.snapshot;
  }

  start(): Promise<HarnessRuntime> {
    if (this.startOperation !== null) return this.startOperation;
    if (
      this.snapshot.status === 'failed' &&
      this.consecutiveFailures >= MAX_START_FAILURES
    ) {
      return Promise.resolve(
        this.publish(
          freezeSnapshot({
            status: 'failed',
            error: 'Harness requires manual restart.',
          }),
        ),
      );
    }
    if (this.snapshot.status === 'running' || this.snapshot.status === 'starting') {
      return Promise.resolve(this.snapshot);
    }

    const operation = this.startInternal();
    this.startOperation = operation;
    void operation.finally(() => {
      if (this.startOperation === operation) this.startOperation = null;
    });
    return operation;
  }

  async restart(): Promise<HarnessRuntime> {
    this.consecutiveFailures = 0;
    if (this.snapshot.status === 'running' || this.snapshot.status === 'starting') {
      await this.stop();
    }
    return this.start();
  }

  async stop(): Promise<HarnessRuntime> {
    this.beginGeneration();
    if (this.snapshot.status === 'checking' || this.snapshot.status === 'failed') {
      return this.snapshot;
    }

    if (this.snapshot.status === 'running' || this.snapshot.status === 'starting') {
      this.transition({
        status: 'stopping',
        pid: this.activeRecord?.pid ?? 0,
        port: this.snapshot.port,
      });
    }

    try {
      await this.process.stop();
    } catch {
      // Checking is still the terminal state for an explicit stop.
    }
    this.activeRecord = null;
    if (this.snapshot.status === 'stopping') {
      return this.transition({ status: 'checking' });
    }
    return this.snapshot;
  }

  private async startInternal(): Promise<HarnessRuntime> {
    const generation = this.beginGeneration();
    const port = await this.getPort({ host: LOOPBACK_HOST });
    if (!this.isCurrent(generation)) return this.snapshot;
    this.transition({ status: 'starting', port });

    try {
      this.activeRecord = await this.process.start(port);
    } catch {
      return this.fail(generation, 'Harness failed to start.');
    }
    if (!this.isCurrent(generation)) return this.snapshot;

    const ready = await this.waitUntilReady(generation, port);
    if (!this.isCurrent(generation) || this.snapshot.status !== 'starting') {
      return this.snapshot;
    }
    if (!ready) {
      await this.safeStopProcess();
      return this.fail(generation, 'Harness startup timed out.');
    }

    const record = this.activeRecord;
    if (record === null) {
      return this.fail(generation, 'Harness failed to start.');
    }
    const running = this.transition({
      status: 'running',
      pid: record.pid,
      port: record.port,
      url: harnessUrl(record.port),
    });
    this.consecutiveFailures = 0;
    void this.watchHealth(generation, `${harnessUrl(record.port)}/`);
    return running;
  }

  private async waitUntilReady(generation: number, port: number): Promise<boolean> {
    const url = `${harnessUrl(port)}/`;
    const deadline = this.now() + STARTUP_TIMEOUT_MS;
    while (
      this.isCurrent(generation) &&
      this.snapshot.status === 'starting' &&
      this.now() < deadline
    ) {
      if (await this.probe(url)) return true;
      if (
        !this.isCurrent(generation) ||
        this.snapshot.status !== 'starting' ||
        this.now() >= deadline
      ) {
        break;
      }
      await this.wait(READY_POLL_MS, this.abort.signal);
    }
    return false;
  }

  private async watchHealth(generation: number, url: string): Promise<void> {
    while (this.isCurrent(generation) && this.snapshot.status === 'running') {
      await this.wait(READY_POLL_MS, this.abort.signal);
      if (!this.isCurrent(generation) || this.snapshot.status !== 'running') {
        return;
      }
      if (await this.probe(url)) continue;

      let recovered = false;
      for (const delay of HEALTH_RETRY_DELAYS_MS) {
        await this.wait(delay, this.abort.signal);
        if (!this.isCurrent(generation) || this.snapshot.status !== 'running') {
          return;
        }
        if (await this.probe(url)) {
          recovered = true;
          break;
        }
      }
      if (!recovered) {
        this.fail(generation, 'Harness health checks failed.');
        await this.safeStopProcess();
        return;
      }
    }
  }

  private handleExit(event: HarnessExitedEvent): void {
    if (this.snapshot.status === 'stopping' || this.snapshot.status === 'checking') {
      return;
    }
    if (this.snapshot.status !== 'running' && this.snapshot.status !== 'starting') {
      return;
    }
    if (this.activeRecord !== null && event.record.pid !== this.activeRecord.pid) {
      return;
    }
    this.activeRecord = null;
    this.fail(this.generation, 'Harness process exited unexpectedly.');
  }

  private fail(generation: number, error: string): HarnessRuntime {
    if (this.snapshot.status === 'failed' || this.snapshot.status === 'checking') {
      return this.snapshot;
    }
    if (
      !this.isCurrent(generation) &&
      this.snapshot.status !== 'starting' &&
      this.snapshot.status !== 'running'
    ) {
      return this.snapshot;
    }
    this.abort.abort();
    this.consecutiveFailures += 1;
    this.activeRecord = null;
    return this.transition({ status: 'failed', error });
  }

  private async safeStopProcess(): Promise<void> {
    try {
      await this.process.stop();
    } catch {
      // The failed snapshot already describes the terminal state.
    }
    this.activeRecord = null;
  }

  private beginGeneration(): number {
    this.abort.abort();
    this.abort = new AbortController();
    this.generation += 1;
    return this.generation;
  }

  private isCurrent(generation: number): boolean {
    return generation === this.generation;
  }

  private transition(next: HarnessRuntime): HarnessRuntime {
    const allowed = ALLOWED_TRANSITIONS[this.snapshot.status];
    if (allowed === undefined || !allowed.has(next.status)) {
      throw new Error(
        `Invalid supervisor transition: ${this.snapshot.status} -> ${next.status}`,
      );
    }
    return this.publish(freezeSnapshot(next));
  }

  private publish(next: HarnessRuntime): HarnessRuntime {
    this.snapshot = next;
    this.emitSafely(next);
    return next;
  }

  private emitSafely(snapshot: HarnessRuntime): void {
    for (const listener of this.rawListeners('snapshot')) {
      try {
        Reflect.apply(listener, this, [snapshot]);
      } catch {
        // Observers must not change supervisor state.
      }
    }
  }
}
