import { EventEmitter } from 'node:events';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HarnessExitedEvent } from '../../src/main/harness/harness-process';
import {
  HarnessSupervisor,
  type HealthProbe,
} from '../../src/main/harness/harness-supervisor';
import type { ProcessRecord } from '../../src/main/harness/process-record-store';
import type { HarnessRuntime } from '../../src/shared/contracts';

interface FakeProcess {
  readonly start: ReturnType<typeof vi.fn<(port: number) => Promise<ProcessRecord>>>;
  readonly stop: ReturnType<
    typeof vi.fn<() => Promise<{ status: 'stopped'; forced: boolean }>>
  >;
  on(event: 'exited', listener: (event: HarnessExitedEvent) => void): unknown;
  crash(exitCode?: number): void;
}

function recordFor(port: number): ProcessRecord {
  return {
    version: 1,
    pid: 4_321,
    startedAt: '2026-08-25T01:02:03.000Z',
    instanceId: 'desktop-session-1',
    port,
    executable: 'dsh',
  };
}

function createFakeProcess(): FakeProcess {
  const emitter = new EventEmitter();
  const start = vi.fn(async (port: number) => recordFor(port));
  const stop = vi.fn(async () => ({
    status: 'stopped' as const,
    forced: false,
  }));
  return {
    start,
    stop,
    on: (event, listener) => emitter.on(event, listener),
    crash(exitCode = 1) {
      const event: HarnessExitedEvent = {
        record: recordFor(18_765),
        exitCode,
        signal: undefined,
      };
      emitter.emit('exited', event);
    },
  };
}

describe('HarnessSupervisor', () => {
  let supervisor: HarnessSupervisor;
  let child: FakeProcess;

  beforeEach(() => {
    vi.useFakeTimers();
    child = createFakeProcess();
  });

  afterEach(async () => {
    await supervisor?.stop();
    vi.useRealTimers();
  });

  function createSupervisor(options: {
    readonly probe: HealthProbe & ReturnType<typeof vi.fn>;
    readonly getPort?: () => Promise<number>;
  }): HarnessSupervisor {
    supervisor = new HarnessSupervisor({
      process: child,
      getPort: options.getPort ?? (async () => 18_765),
      probe: options.probe,
    });
    return supervisor;
  }

  it('selects a loopback port, waits for readiness, then reaches running', async () => {
    const probe = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);
    const getPort = vi.fn(async () => 18_765);
    const snapshots: HarnessRuntime[] = [];
    const instance = createSupervisor({ probe, getPort });
    instance.on('snapshot', (snapshot) => snapshots.push(snapshot));

    const started = instance.start();
    await vi.advanceTimersByTimeAsync(250);
    const result = await started;

    expect(getPort).toHaveBeenCalledExactlyOnceWith({ host: '127.0.0.1' });
    expect(child.start).toHaveBeenCalledExactlyOnceWith(18_765);
    expect(probe).toHaveBeenCalledWith('http://127.0.0.1:18765/');
    expect(snapshots[0]).toEqual({ status: 'starting', port: 18_765 });
    expect(result).toEqual({
      status: 'running',
      pid: 4_321,
      port: 18_765,
      url: 'http://127.0.0.1:18765',
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(instance.getSnapshot()).toEqual(result);
    expect(snapshots.map((snapshot) => snapshot.status)).toEqual([
      'starting',
      'running',
    ]);
  });

  it('does not emit running before the health probe succeeds', async () => {
    const probe = vi.fn().mockResolvedValue(false);
    const instance = createSupervisor({ probe });
    const started = instance.start();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(instance.getSnapshot().status).toBe('starting');
    expect(probe.mock.calls.length).toBeGreaterThan(1);
    await vi.advanceTimersByTimeAsync(19_000);
    await expect(started).resolves.toMatchObject({ status: 'failed' });
  });

  it('fails after a 20 second startup timeout and then allows manual restart', async () => {
    const probe = vi.fn().mockResolvedValue(false);
    const instance = createSupervisor({ probe });

    const timedOut = instance.start();
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(timedOut).resolves.toMatchObject({
      status: 'failed',
      error: 'Harness startup timed out.',
    });

    probe.mockResolvedValue(true);
    const restarted = instance.restart();
    await vi.advanceTimersByTimeAsync(250);
    await expect(restarted).resolves.toMatchObject({ status: 'running' });
  });

  it('retries disconnected health checks at 1, 2, and 4 seconds then fails', async () => {
    const probe = vi.fn().mockResolvedValue(true);
    const instance = createSupervisor({ probe });
    const started = instance.start();
    await vi.advanceTimersByTimeAsync(250);
    await started;

    probe.mockResolvedValue(false);
    await vi.advanceTimersByTimeAsync(250 + 1_000 + 2_000 + 4_000);
    expect(instance.getSnapshot()).toMatchObject({
      status: 'failed',
      error: 'Harness health checks failed.',
    });
  });

  it('stays running when a health retry succeeds', async () => {
    const probe = vi.fn().mockResolvedValue(true);
    const instance = createSupervisor({ probe });
    const started = instance.start();
    await vi.advanceTimersByTimeAsync(250);
    await started;

    probe.mockResolvedValueOnce(false).mockResolvedValue(true);
    await vi.advanceTimersByTimeAsync(250 + 1_000);
    expect(instance.getSnapshot().status).toBe('running');
  });

  it('transitions to failed when the process crashes', async () => {
    const probe = vi.fn().mockResolvedValue(true);
    const instance = createSupervisor({ probe });
    const started = instance.start();
    await vi.advanceTimersByTimeAsync(250);
    await started;

    child.crash(23);
    await Promise.resolve();
    expect(instance.getSnapshot()).toMatchObject({
      status: 'failed',
      error: 'Harness process exited unexpectedly.',
    });
  });

  it('does not automatically restart after an explicit stop', async () => {
    const probe = vi.fn().mockResolvedValue(true);
    const instance = createSupervisor({ probe });
    const started = instance.start();
    await vi.advanceTimersByTimeAsync(250);
    await started;
    const starts = child.start.mock.calls.length;

    await expect(instance.stop()).resolves.toEqual({ status: 'checking' });
    child.crash(1);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(instance.getSnapshot()).toEqual({ status: 'checking' });
    expect(child.start).toHaveBeenCalledTimes(starts);
  });

  it('requires a manual restart after three failed startups', async () => {
    const probe = vi.fn().mockResolvedValue(false);
    const getPort = vi.fn(async () => 18_765);
    const instance = createSupervisor({ probe, getPort });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const started = instance.start();
      await vi.advanceTimersByTimeAsync(20_000);
      await expect(started).resolves.toMatchObject({ status: 'failed' });
    }

    expect(getPort).toHaveBeenCalledTimes(3);
    getPort.mockClear();
    await expect(instance.start()).resolves.toMatchObject({
      status: 'failed',
      error: 'Harness requires manual restart.',
    });
    expect(getPort).not.toHaveBeenCalled();

    const recovered = instance.restart();
    await vi.advanceTimersByTimeAsync(20_000);
    await recovered;
    expect(getPort).toHaveBeenCalledTimes(1);
  });
});
