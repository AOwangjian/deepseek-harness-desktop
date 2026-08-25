import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { Readable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';

import { execa } from 'execa';

import type { ProcessRecord } from './process-record-store';

const GRACEFUL_STOP_TIMEOUT_MS = 5_000;
const MAX_LOG_LINES = 200;
const MAX_LOG_LINE_LENGTH = 2_048;
const LOG_TRUNCATED_LINE = 'Harness output truncated.';

export interface HarnessProcessResult {
  readonly exitCode: number | null | undefined;
  readonly signal?: string | null;
}

export interface HarnessChildProcess
  extends PromiseLike<HarnessProcessResult> {
  readonly pid?: number;
  readonly stdout?: Readable | null;
  readonly stderr?: Readable | null;
  kill(signal: 'SIGTERM'): boolean;
}

export interface HarnessSpawnOptions {
  readonly shell: false;
  readonly windowsHide: true;
  readonly reject: false;
  readonly buffer: false;
  readonly killDescendants: false;
}

export type HarnessSpawn = (
  executable: string,
  args: readonly string[],
  options: HarnessSpawnOptions,
) => HarnessChildProcess;

export interface ProcessRecordRepository {
  read(): Promise<ProcessRecord | null>;
  write(record: ProcessRecord): Promise<void>;
  deleteIfOwned(instanceId: string): Promise<boolean>;
}

export type VerifiedProcessTreeTerminator = (
  record: ProcessRecord,
) => Promise<void>;

export interface HarnessLogEvent {
  readonly stream: 'stdout' | 'stderr';
  readonly line: string;
}

export interface HarnessExitedEvent {
  readonly record: ProcessRecord;
  readonly exitCode: number | null;
  readonly signal: string | undefined;
}

export type HarnessStopResult =
  | { readonly status: 'not-running' }
  | { readonly status: 'not-owned' }
  | { readonly status: 'stopped'; readonly forced: boolean };

export type HarnessProcessErrorCode =
  | 'PROCESS_ALREADY_RUNNING'
  | 'PROCESS_INVALID_PORT'
  | 'PROCESS_RECORD_EXISTS'
  | 'PROCESS_SPAWN_FAILED';

export class HarnessProcessError extends Error {
  readonly code: HarnessProcessErrorCode;

  constructor(code: HarnessProcessErrorCode, message: string) {
    super(message);
    this.name = 'HarnessProcessError';
    this.code = code;
  }
}

export interface HarnessProcessOptions {
  readonly recordStore: ProcessRecordRepository;
  readonly terminateTree: VerifiedProcessTreeTerminator;
  readonly spawn?: HarnessSpawn;
  readonly now?: () => Date;
  readonly instanceId?: string;
  readonly wait?: (milliseconds: number) => Promise<void>;
  readonly executable?: string;
  readonly executableArgs?: readonly string[];
}

export function defaultHarnessSpawn(
  executable: string,
  args: readonly string[],
  options: HarnessSpawnOptions,
): HarnessChildProcess {
  return execa(executable, [...args], options) as unknown as HarnessChildProcess;
}

function defaultWait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function validPort(port: number): boolean {
  return Number.isInteger(port) && port > 0 && port <= 65_535;
}

function validPid(pid: number | undefined): pid is number {
  return typeof pid === 'number' && Number.isInteger(pid) && pid > 0;
}

function normalizedExit(result: HarnessProcessResult): {
  readonly exitCode: number | null;
  readonly signal: string | undefined;
} {
  return {
    exitCode: typeof result.exitCode === 'number' ? result.exitCode : null,
    signal: typeof result.signal === 'string' ? result.signal : undefined,
  };
}

export interface HarnessProcess {
  on(event: 'started', listener: (record: ProcessRecord) => void): this;
  on(event: 'exited', listener: (event: HarnessExitedEvent) => void): this;
  on(event: 'log', listener: (event: HarnessLogEvent) => void): this;
}

/** Owns exactly one direct Harness child and its persisted ownership record. */
export class HarnessProcess extends EventEmitter {
  private readonly recordStore: ProcessRecordRepository;
  private readonly terminateTree: VerifiedProcessTreeTerminator;
  private readonly spawn: HarnessSpawn;
  private readonly now: () => Date;
  private readonly instanceId: string;
  private readonly wait: (milliseconds: number) => Promise<void>;
  private readonly executable: string;
  private readonly executableArgs: readonly string[];
  private child: HarnessChildProcess | null = null;
  private ownedRecord: ProcessRecord | null = null;
  private exitCompletion: Promise<void> | null = null;
  private stopOperation: Promise<HarnessStopResult> | null = null;
  private logLines: HarnessLogEvent[] = [];
  private outputTruncated = false;

  constructor(options: HarnessProcessOptions) {
    super();
    this.recordStore = options.recordStore;
    this.terminateTree = options.terminateTree;
    this.spawn = options.spawn ?? defaultHarnessSpawn;
    this.now = options.now ?? (() => new Date());
    this.instanceId = options.instanceId ?? randomUUID();
    this.wait = options.wait ?? defaultWait;
    this.executable = options.executable ?? 'dsh';
    this.executableArgs = Object.freeze([...(options.executableArgs ?? [])]);
  }

  get recentLogs(): readonly HarnessLogEvent[] {
    return [...this.logLines];
  }

  async start(port: number): Promise<ProcessRecord> {
    if (this.child !== null) {
      throw new HarnessProcessError(
        'PROCESS_ALREADY_RUNNING',
        'This Harness process is already running.',
      );
    }
    if (!validPort(port)) {
      throw new HarnessProcessError(
        'PROCESS_INVALID_PORT',
        'The Harness port must be an integer from 1 through 65535.',
      );
    }
    if ((await this.recordStore.read()) !== null) {
      throw new HarnessProcessError(
        'PROCESS_RECORD_EXISTS',
        'A Harness process record already exists.',
      );
    }

    const args = [
      ...this.executableArgs,
      'web',
      '--no-open',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
    ];
    let child: HarnessChildProcess;
    try {
      child = this.spawn(this.executable, args, {
        shell: false,
        windowsHide: true,
        reject: false,
        buffer: false,
        killDescendants: false,
      });
    } catch {
      throw new HarnessProcessError(
        'PROCESS_SPAWN_FAILED',
        'The Harness process could not be started.',
      );
    }

    if (!validPid(child.pid)) {
      try {
        child.kill('SIGTERM');
      } catch {
        // The safe error below intentionally excludes raw process failure fields.
      }
      throw new HarnessProcessError(
        'PROCESS_SPAWN_FAILED',
        'The Harness process did not provide a valid PID.',
      );
    }

    const record: ProcessRecord = {
      version: 1,
      pid: child.pid,
      startedAt: this.now().toISOString(),
      instanceId: this.instanceId,
      port,
      executable: this.executable,
    };
    let recordPersisted = false;
    let releasePersistence: (() => void) | undefined;
    const persistenceSettled = new Promise<void>((resolve) => {
      releasePersistence = resolve;
    });

    this.child = child;
    this.ownedRecord = record;
    this.logLines = [];
    this.outputTruncated = false;
    this.attachOutput(child.stdout, 'stdout');
    this.attachOutput(child.stderr, 'stderr');
    this.exitCompletion = Promise.resolve(child)
      .then((result) => normalizedExit(result))
      .catch(() => ({ exitCode: null, signal: undefined }))
      .then(async (exit) => {
        await persistenceSettled;
        try {
          if (recordPersisted) {
            await this.recordStore.deleteIfOwned(this.instanceId);
          }
        } finally {
          if (this.child === child) {
            this.child = null;
            this.ownedRecord = null;
            this.exitCompletion = null;
          }
          this.emitSafely(
            'exited',
            { record, ...exit } satisfies HarnessExitedEvent,
          );
        }
      });

    try {
      await this.recordStore.write(record);
      recordPersisted = true;
      this.emitSafely('started', record);
      return record;
    } catch (error: unknown) {
      try {
        child.kill('SIGTERM');
      } catch {
        // Preserve the safe record-store error and avoid exposing child details.
      }
      throw error;
    } finally {
      releasePersistence?.();
    }
  }

  stop(): Promise<HarnessStopResult> {
    if (this.stopOperation !== null) return this.stopOperation;

    const operation = this.stopInternal();
    this.stopOperation = operation;
    const clearStopOperation = (): void => {
      if (this.stopOperation === operation) this.stopOperation = null;
    };
    void operation.then(clearStopOperation, clearStopOperation);
    return operation;
  }

  private async stopInternal(): Promise<HarnessStopResult> {
    const child = this.child;
    const ownedRecord = this.ownedRecord;
    const exitCompletion = this.exitCompletion;
    if (child === null || ownedRecord === null || exitCompletion === null) {
      return { status: 'not-running' };
    }

    const persistedRecord = await this.recordStore.read();
    if (this.child !== child) return { status: 'not-running' };
    if (!this.isOwnedRecord(persistedRecord, ownedRecord)) {
      return { status: 'not-owned' };
    }

    try {
      child.kill('SIGTERM');
    } catch {
      // The verified tree terminator remains the bounded fallback.
    }

    const outcome = await Promise.race([
      exitCompletion.then(() => 'exited' as const),
      this.wait(GRACEFUL_STOP_TIMEOUT_MS).then(() => 'timed-out' as const),
    ]);
    if (outcome === 'exited') {
      return { status: 'stopped', forced: false };
    }

    if (this.child !== child) {
      await exitCompletion;
      return { status: 'stopped', forced: false };
    }

    const recordBeforeTermination = await this.recordStore.read();
    if (!this.isOwnedRecord(recordBeforeTermination, ownedRecord)) {
      return { status: 'not-owned' };
    }

    await this.terminateTree(ownedRecord);
    await exitCompletion;
    return { status: 'stopped', forced: true };
  }

  private isOwnedRecord(
    record: ProcessRecord | null,
    expected: ProcessRecord,
  ): record is ProcessRecord {
    return (
      record !== null &&
      record.instanceId === this.instanceId &&
      record.pid === expected.pid
    );
  }

  private attachOutput(
    stream: Readable | null | undefined,
    streamName: HarnessLogEvent['stream'],
  ): void {
    if (stream === null || stream === undefined) return;

    const decoder = new StringDecoder('utf8');
    let pending = '';
    let pendingTruncated = false;

    const append = (fragment: string): void => {
      const remaining = MAX_LOG_LINE_LENGTH - pending.length;
      if (fragment.length > remaining) pendingTruncated = true;
      if (remaining > 0) pending += fragment.slice(0, remaining);
    };
    const flush = (): void => {
      if (pending.endsWith('\r')) pending = pending.slice(0, -1);
      const line = pendingTruncated
        ? `${pending.slice(0, MAX_LOG_LINE_LENGTH - 1)}…`
        : pending;
      this.captureLog({ stream: streamName, line });
      pending = '';
      pendingTruncated = false;
    };
    const consume = (text: string): void => {
      let offset = 0;
      while (offset < text.length) {
        const newline = text.indexOf('\n', offset);
        if (newline === -1) {
          append(text.slice(offset));
          return;
        }
        append(text.slice(offset, newline));
        flush();
        offset = newline + 1;
      }
    };

    stream.on('data', (chunk: unknown) => {
      const buffer = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(String(chunk), 'utf8');
      consume(decoder.write(buffer));
    });
    stream.on('end', () => {
      consume(decoder.end());
      if (pending.length > 0 || pendingTruncated) flush();
    });
  }

  private captureLog(event: HarnessLogEvent): void {
    if (this.outputTruncated) return;
    if (this.logLines.length >= MAX_LOG_LINES - 1) {
      const truncatedEvent: HarnessLogEvent = {
        stream: event.stream,
        line: LOG_TRUNCATED_LINE,
      };
      this.logLines.push(truncatedEvent);
      this.outputTruncated = true;
      this.emitSafely('log', truncatedEvent);
      return;
    }

    this.logLines.push(event);
    this.emitSafely('log', event);
  }

  private emitSafely(
    eventName: 'started' | 'exited' | 'log',
    payload: ProcessRecord | HarnessExitedEvent | HarnessLogEvent,
  ): void {
    for (const listener of this.rawListeners(eventName)) {
      try {
        Reflect.apply(listener, this, [payload]);
      } catch {
        // Observers must not alter ownership or child-process cleanup.
      }
    }
  }
}
