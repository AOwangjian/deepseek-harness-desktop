import type { ProcessRecord } from '../harness/process-record-store';

export interface ProcessInspection {
  readonly executable: string;
  readonly startedAt: string;
}

export type ProcessInspector = (pid: number) => Promise<ProcessInspection | null>;
export type ProcessTreeTerminator = (pid: number) => Promise<void>;

export class UnownedProcessError extends Error {
  readonly code = 'PROCESS_NOT_OWNED';

  constructor(message = 'The process is not owned by this desktop session.') {
    super(message);
    this.name = 'UnownedProcessError';
  }
}

export interface PlatformAdapter {
  setAutoStart(enabled: boolean): void;
  getAutoStart(): boolean;
  terminateOwnedProcessTree(record: ProcessRecord): Promise<void>;
  showNotification(title: string, body: string): void;
  openPath(target: string): Promise<void>;
}
