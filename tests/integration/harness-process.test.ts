import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import getPort from 'get-port';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  HarnessProcess,
  type HarnessExitedEvent,
} from '../../src/main/harness/harness-process';
import { ProcessRecordStore } from '../../src/main/harness/process-record-store';

const fixturePath = fileURLToPath(
  new URL('./fixtures/fake-harness.mjs', import.meta.url),
);

function processIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function forceFixtureExit(pid: number): Promise<void> {
  if (!processIsRunning(pid)) return;
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // The fixture already exited between the verified probe and termination.
  }
  await vi.waitFor(() => expect(processIsRunning(pid)).toBe(false));
}

describe('HarnessProcess real child lifecycle', () => {
  const temporaryDirectories: string[] = [];
  const fixturePids: number[] = [];

  afterEach(async () => {
    await Promise.all(fixturePids.splice(0).map(forceFixtureExit));
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
  });

  async function createFixtureManager(
    executableArgs: readonly string[] = [fixturePath],
  ): Promise<{
    readonly manager: HarnessProcess;
    readonly store: ProcessRecordStore;
  }> {
    const userDataPath = await mkdtemp(
      path.join(tmpdir(), 'dsh-harness-integration-'),
    );
    temporaryDirectories.push(userDataPath);
    const store = new ProcessRecordStore({ userDataPath });
    const manager = new HarnessProcess({
      recordStore: store,
      executable: process.execPath,
      executableArgs,
      instanceId: 'integration-test-session',
      terminateTree: async (record) => {
        if (!processIsRunning(record.pid)) return;
        process.kill(record.pid, 'SIGKILL');
      },
    });
    return { manager, store };
  }

  it(
    'starts, serves health, stops gracefully, and removes its owned record',
    async () => {
      const { manager, store } = await createFixtureManager();
      const port = await getPort({ host: '127.0.0.1' });
      const ready = new Promise<void>((resolve) => {
        manager.on('log', (event) => {
          if (event.stream === 'stdout' && event.line === 'READY') resolve();
        });
      });

      const record = await manager.start(port);
      fixturePids.push(record.pid);
      await ready;

      await expect(fetch(`http://127.0.0.1:${port}/health`)).resolves.toMatchObject({
        status: 200,
      });
      await expect(
        fetch(`http://127.0.0.1:${port}/health`).then((response) =>
          response.json(),
        ),
      ).resolves.toEqual({ status: 'ok' });
      await expect(store.read()).resolves.toEqual(record);

      await expect(manager.stop()).resolves.toEqual({
        status: 'stopped',
        forced: false,
      });
      await expect(store.read()).resolves.toBeNull();
      expect(processIsRunning(record.pid)).toBe(false);
    },
    10_000,
  );

  it(
    'cleans its record when the fixture crashes',
    async () => {
      const { manager, store } = await createFixtureManager([
        fixturePath,
        '--crash',
      ]);
      const port = await getPort({ host: '127.0.0.1' });
      let resolveExit: ((event: HarnessExitedEvent) => void) | undefined;
      const exited = new Promise<HarnessExitedEvent>((resolve) => {
        resolveExit = resolve;
      });
      manager.on('exited', (event) => resolveExit?.(event));

      const record = await manager.start(port);
      fixturePids.push(record.pid);

      await expect(exited).resolves.toMatchObject({ record, exitCode: 23 });
      await expect(store.read()).resolves.toBeNull();
      expect(processIsRunning(record.pid)).toBe(false);
    },
    10_000,
  );
});
