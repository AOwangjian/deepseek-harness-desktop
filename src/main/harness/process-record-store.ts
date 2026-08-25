import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { App } from 'electron';

export interface ProcessRecord {
  readonly version: 1;
  readonly pid: number;
  readonly startedAt: string;
  readonly instanceId: string;
  readonly port: number;
  readonly executable: string;
}

export type ProcessRecordStoreErrorCode =
  | 'PROCESS_RECORD_EXISTS'
  | 'PROCESS_RECORD_INVALID';

export class ProcessRecordStoreError extends Error {
  readonly code: ProcessRecordStoreErrorCode;

  constructor(code: ProcessRecordStoreErrorCode, message: string) {
    super(message);
    this.name = 'ProcessRecordStoreError';
    this.code = code;
  }
}

export interface ProcessRecordStoreOptions {
  readonly userDataPath: string;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === 'number' && value > 0;
}

function parseRecord(value: unknown): ProcessRecord {
  if (typeof value !== 'object' || value === null) {
    throw new ProcessRecordStoreError(
      'PROCESS_RECORD_INVALID',
      'The Harness process record is invalid.',
    );
  }

  const candidate = value as Record<string, unknown>;
  const startedAt = candidate.startedAt;
  const startedAtDate =
    typeof startedAt === 'string' ? new Date(startedAt) : undefined;
  const validStartedAt =
    startedAtDate !== undefined &&
    !Number.isNaN(startedAtDate.valueOf()) &&
    startedAtDate.toISOString() === startedAt;

  if (
    candidate.version !== 1 ||
    !isPositiveInteger(candidate.pid) ||
    !validStartedAt ||
    typeof candidate.instanceId !== 'string' ||
    candidate.instanceId.length === 0 ||
    !isPositiveInteger(candidate.port) ||
    candidate.port > 65_535 ||
    typeof candidate.executable !== 'string' ||
    candidate.executable.length === 0
  ) {
    throw new ProcessRecordStoreError(
      'PROCESS_RECORD_INVALID',
      'The Harness process record is invalid.',
    );
  }

  return {
    version: 1,
    pid: candidate.pid,
    startedAt,
    instanceId: candidate.instanceId,
    port: candidate.port,
    executable: candidate.executable,
  };
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

/** Stores the one process record owned by the desktop app. */
export class ProcessRecordStore {
  readonly recordPath: string;

  constructor(options: ProcessRecordStoreOptions) {
    this.recordPath = path.join(
      options.userDataPath,
      'runtime',
      'owned-process.json',
    );
  }

  async read(): Promise<ProcessRecord | null> {
    let serialized: string;
    try {
      serialized = await readFile(this.recordPath, 'utf8');
    } catch (error: unknown) {
      if (isMissingFile(error)) return null;
      throw error;
    }

    try {
      return parseRecord(JSON.parse(serialized) as unknown);
    } catch (error: unknown) {
      if (error instanceof ProcessRecordStoreError) throw error;
      throw new ProcessRecordStoreError(
        'PROCESS_RECORD_INVALID',
        'The Harness process record is invalid.',
      );
    }
  }

  async write(record: ProcessRecord): Promise<void> {
    const validatedRecord = parseRecord(record);
    await mkdir(path.dirname(this.recordPath), { recursive: true });

    if ((await this.read()) !== null) {
      throw new ProcessRecordStoreError(
        'PROCESS_RECORD_EXISTS',
        'A Harness process record already exists.',
      );
    }

    const temporaryPath = path.join(
      path.dirname(this.recordPath),
      `.${path.basename(this.recordPath)}.${process.pid}.${randomUUID()}.tmp`,
    );

    try {
      await writeFile(temporaryPath, JSON.stringify(validatedRecord), {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
      await rename(temporaryPath, this.recordPath);
    } catch (error: unknown) {
      await unlink(temporaryPath).catch((cleanupError: unknown) => {
        if (!isMissingFile(cleanupError)) {
          // Preserve the original write error; a later startup can ignore temp files.
        }
      });
      throw error;
    }
  }

  async deleteIfOwned(instanceId: string): Promise<boolean> {
    const record = await this.read();
    if (record === null || record.instanceId !== instanceId) return false;

    try {
      await unlink(this.recordPath);
      return true;
    } catch (error: unknown) {
      if (isMissingFile(error)) return false;
      throw error;
    }
  }
}

export function createAppProcessRecordStore(
  app: Pick<App, 'getPath'>,
): ProcessRecordStore {
  return new ProcessRecordStore({ userDataPath: app.getPath('userData') });
}
