import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { execa } from 'execa';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  HarnessProcess,
  type HarnessChildProcess,
  type HarnessProcessResult,
  type ProcessRecordRepository,
} from '../../src/main/harness/harness-process';
import {
  ProcessRecordStore,
  createAppProcessRecordStore,
  type ProcessRecord,
} from '../../src/main/harness/process-record-store';

vi.mock('execa', () => ({ execa: vi.fn() }));

interface ControlledChild {
  readonly child: HarnessChildProcess;
  readonly stdout: PassThrough;
  readonly stderr: PassThrough;
  readonly kill: ReturnType<typeof vi.fn>;
  readonly exit: (result?: HarnessProcessResult) => void;
}

function controlledChild(pid = 4_321): ControlledChild {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const kill = vi.fn(() => true);
  let resolveExit: ((result: HarnessProcessResult) => void) | undefined;
  const completion = new Promise<HarnessProcessResult>((resolve) => {
    resolveExit = resolve;
  });
  const child = Object.assign(completion, { pid, stdout, stderr, kill });

  return {
    child,
    stdout,
    stderr,
    kill,
    exit: (result = { exitCode: 0, signal: undefined }) => resolveExit?.(result),
  };
}

function memoryStore(initial: ProcessRecord | null = null): {
  readonly store: ProcessRecordRepository;
  getRecord(): ProcessRecord | null;
  setRecord(record: ProcessRecord | null): void;
} {
  let record = initial;
  return {
    store: {
      read: vi.fn(async () => record),
      write: vi.fn(async (nextRecord) => {
        record = nextRecord;
      }),
      deleteIfOwned: vi.fn(async (instanceId) => {
        if (record?.instanceId !== instanceId) return false;
        record = null;
        return true;
      }),
    },
    getRecord: () => record,
    setRecord: (nextRecord) => {
      record = nextRecord;
    },
  };
}

function createManager(options: {
  readonly child?: ControlledChild;
  readonly repository?: ReturnType<typeof memoryStore>;
  readonly wait?: (milliseconds: number) => Promise<void>;
  readonly terminateTree?: (record: ProcessRecord) => Promise<void>;
} = {}) {
  const process = options.child ?? controlledChild();
  const repository = options.repository ?? memoryStore();
  const terminateTree = vi.fn(options.terminateTree ?? (async () => undefined));
  const spawn = vi.fn(() => process.child);
  const manager = new HarnessProcess({
    recordStore: repository.store,
    terminateTree,
    spawn,
    now: () => new Date('2026-08-25T01:02:03.000Z'),
    instanceId: 'desktop-session-1',
    wait: options.wait ?? (async () => new Promise(() => undefined)),
  });

  return { manager, process, repository, spawn, terminateTree };
}

describe('HarnessProcess', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('starts dsh directly with the exact web arguments and persists ownership', async () => {
    const process = controlledChild();
    vi.mocked(execa).mockReturnValue(process.child as never);
    const repository = memoryStore();
    const started = vi.fn();
    const manager = new HarnessProcess({
      recordStore: repository.store,
      terminateTree: vi.fn(async () => undefined),
      now: () => new Date('2026-08-25T01:02:03.000Z'),
      instanceId: 'desktop-session-1',
      wait: async () => new Promise(() => undefined),
    });
    manager.on('started', started);

    const record = await manager.start(18_765);

    expect(execa).toHaveBeenCalledWith(
      'dsh',
      ['web', '--no-open', '--host', '127.0.0.1', '--port', '18765'],
      {
        shell: false,
        windowsHide: true,
        reject: false,
        buffer: false,
        killDescendants: false,
      },
    );
    expect(record).toEqual({
      version: 1,
      pid: 4_321,
      startedAt: '2026-08-25T01:02:03.000Z',
      instanceId: 'desktop-session-1',
      port: 18_765,
      executable: 'dsh',
    });
    expect(repository.getRecord()).toEqual(record);
    expect(started).toHaveBeenCalledExactlyOnceWith(record);
  });

  it('refuses a second start while its child is running', async () => {
    const { manager, spawn } = createManager();
    await manager.start(18_765);

    await expect(manager.start(18_766)).rejects.toMatchObject({
      code: 'PROCESS_ALREADY_RUNNING',
    });
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('refuses to stop when the persisted record belongs to another app session', async () => {
    const { manager, process, repository, terminateTree } = createManager();
    await manager.start(18_765);
    repository.setRecord({
      ...repository.getRecord()!,
      instanceId: 'another-desktop-session',
    });

    await expect(manager.stop()).resolves.toEqual({ status: 'not-owned' });
    expect(process.kill).not.toHaveBeenCalled();
    expect(terminateTree).not.toHaveBeenCalled();
    expect(repository.store.deleteIfOwned).not.toHaveBeenCalled();
    expect(repository.getRecord()?.instanceId).toBe('another-desktop-session');
  });

  it('sends SIGTERM, waits for exit, deletes its record, and emits exited', async () => {
    const { manager, process, repository, terminateTree } = createManager();
    const exited = vi.fn();
    manager.on('exited', exited);
    const record = await manager.start(18_765);

    const stopping = manager.stop();
    await vi.waitFor(() => expect(process.kill).toHaveBeenCalledWith('SIGTERM'));
    process.exit({ exitCode: 0, signal: 'SIGTERM' });

    await expect(stopping).resolves.toEqual({
      status: 'stopped',
      forced: false,
    });
    expect(terminateTree).not.toHaveBeenCalled();
    expect(repository.getRecord()).toBeNull();
    expect(exited).toHaveBeenCalledExactlyOnceWith({
      record,
      exitCode: 0,
      signal: 'SIGTERM',
    });
  });

  it('uses the verified tree terminator only after the five-second grace period', async () => {
    const process = controlledChild();
    const wait = vi.fn(async () => undefined);
    const terminateTree = vi.fn(async () => {
      process.exit({ exitCode: null, signal: 'SIGKILL' });
    });
    const fixture = createManager({ child: process, wait, terminateTree });
    const record = await fixture.manager.start(18_765);

    await expect(fixture.manager.stop()).resolves.toEqual({
      status: 'stopped',
      forced: true,
    });
    expect(wait).toHaveBeenNthCalledWith(1, 5_000);
    expect(terminateTree).toHaveBeenCalledExactlyOnceWith(record);
    expect(fixture.repository.getRecord()).toBeNull();
  });

  it('does not hang restart when the tree terminator cannot reap the child', async () => {
    const process = controlledChild();
    const wait = vi.fn(async () => undefined);
    const terminateTree = vi.fn(async () => undefined);
    const fixture = createManager({ child: process, wait, terminateTree });
    await fixture.manager.start(18_765);

    await expect(fixture.manager.stop()).resolves.toEqual({
      status: 'stopped',
      forced: true,
    });
    expect(wait).toHaveBeenCalledTimes(2);
    expect(terminateTree).toHaveBeenCalledOnce();
    expect(fixture.repository.getRecord()).toBeNull();
  });

  it('decodes split UTF-8, handles CRLF and emits a trailing line', async () => {
    const { manager, process } = createManager();
    const logs: Array<{ stream: string; line: string }> = [];
    manager.on('log', (event) => logs.push(event));
    await manager.start(18_765);
    const chinese = Buffer.from('启动完成', 'utf8');

    process.stdout.write(chinese.subarray(0, 2));
    process.stdout.write(chinese.subarray(2));
    process.stdout.write(Buffer.from('\r\nnext', 'utf8'));
    process.stdout.end();
    process.stderr.end('warning\r\n');

    await vi.waitFor(() => expect(logs).toHaveLength(3));
    expect(logs).toEqual([
      { stream: 'stdout', line: '启动完成' },
      { stream: 'stderr', line: 'warning' },
      { stream: 'stdout', line: 'next' },
    ]);
    expect(logs.map(({ line }) => line).join('')).not.toContain('�');
  });

  it('bounds emitted process output by both line count and line length', async () => {
    const { manager, process } = createManager();
    const logs: Array<{ stream: string; line: string }> = [];
    manager.on('log', (event) => logs.push(event));
    await manager.start(18_765);

    process.stdout.end(`${'x'.repeat(10_000)}\n${'line\n'.repeat(500)}`);

    await vi.waitFor(() =>
      expect(logs.at(-1)?.line).toBe('Harness output truncated.'),
    );
    expect(logs.length).toBeLessThanOrEqual(200);
    expect(logs.every(({ line }) => line.length <= 2_048)).toBe(true);
  });

  it('does not leak raw spawn failure fields', async () => {
    const repository = memoryStore();
    const secret = 'TOP_SECRET_ENV_VALUE';
    const manager = new HarnessProcess({
      recordStore: repository.store,
      terminateTree: vi.fn(async () => undefined),
      spawn: () => {
        throw { code: 'ENOENT', stdout: secret, stderr: secret, env: { SECRET: secret } };
      },
      instanceId: 'desktop-session-1',
    });

    const error = await manager.start(18_765).catch((reason: unknown) => reason);

    expect(error).toMatchObject({ code: 'PROCESS_SPAWN_FAILED' });
    expect(JSON.stringify(error)).not.toContain(secret);
    expect(error).not.toHaveProperty('stdout');
    expect(error).not.toHaveProperty('stderr');
    expect(error).not.toHaveProperty('env');
  });

  it('isolates event listener failures from the owned process lifecycle', async () => {
    const { manager, process } = createManager();
    manager.on('started', () => {
      throw new Error('started observer failed');
    });
    manager.on('log', () => {
      throw new Error('log observer failed');
    });
    manager.on('exited', () => {
      throw new Error('exited observer failed');
    });

    await expect(manager.start(18_765)).resolves.toMatchObject({ pid: 4_321 });
    expect(() => process.stdout.write('READY\n')).not.toThrow();
    const stopping = manager.stop();
    await vi.waitFor(() => expect(process.kill).toHaveBeenCalledWith('SIGTERM'));
    process.exit({ exitCode: 0, signal: 'SIGTERM' });

    await expect(stopping).resolves.toEqual({
      status: 'stopped',
      forced: false,
    });
  });
});

describe('ProcessRecordStore', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
  });

  async function temporaryStore(): Promise<{
    readonly directory: string;
    readonly store: ProcessRecordStore;
  }> {
    const directory = await mkdtemp(path.join(tmpdir(), 'dsh-owned-process-'));
    temporaryDirectories.push(directory);
    return {
      directory,
      store: new ProcessRecordStore({ userDataPath: directory }),
    };
  }

  const record: ProcessRecord = {
    version: 1,
    pid: 4_321,
    startedAt: '2026-08-25T01:02:03.000Z',
    instanceId: 'desktop-session-1',
    port: 18_765,
    executable: 'dsh',
  };

  it('writes UTF-8 JSON through a sibling temporary file and atomic rename', async () => {
    const { store } = await temporaryStore();

    await store.write(record);

    await expect(store.read()).resolves.toEqual(record);
    expect(JSON.parse(await readFile(store.recordPath, 'utf8'))).toEqual(record);
    await expect(readdir(path.dirname(store.recordPath))).resolves.toEqual([
      'owned-process.json',
    ]);
  });

  it('never overwrites or deletes a foreign record', async () => {
    const { store } = await temporaryStore();
    await store.write(record);
    const foreignRecord = { ...record, instanceId: 'another-desktop-session' };

    await expect(store.write(foreignRecord)).rejects.toMatchObject({
      code: 'PROCESS_RECORD_EXISTS',
    });
    await expect(store.deleteIfOwned('another-desktop-session')).resolves.toBe(
      false,
    );
    await expect(store.read()).resolves.toEqual(record);
  });

  it('deletes a record only when the instance ID matches', async () => {
    const { store } = await temporaryStore();
    await store.write(record);

    await expect(store.deleteIfOwned('desktop-session-1')).resolves.toBe(true);
    await expect(store.read()).resolves.toBeNull();
  });

  it('derives its runtime path from app.getPath(userData)', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'dsh-app-user-data-'));
    temporaryDirectories.push(directory);
    const getPath = vi.fn(() => directory);

    const store = createAppProcessRecordStore({ getPath });

    expect(getPath).toHaveBeenCalledExactlyOnceWith('userData');
    expect(store.recordPath).toBe(
      path.join(directory, 'runtime', 'owned-process.json'),
    );
  });
});
