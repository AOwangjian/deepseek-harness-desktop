import {
  containsConversationBody,
  looksLikeEnvironmentDump,
  redactSecrets,
} from './redactor';
import type {
  DependencySnapshot,
  DiagnosticSummary,
  HarnessRuntime,
} from '../../shared/contracts';

export const MAX_LOG_LINES = 2_000;
export const MAX_LOG_BYTES = 2 * 1024 * 1024;

export interface DiagnosticReport {
  readonly appVersion: string;
  readonly osVersion: string;
  readonly generatedAt: string;
  readonly dependencies: DependencySnapshot;
  readonly runtime: HarnessRuntime;
  readonly recentLogs: readonly string[];
}

export class DiagnosticService {
  private readonly lines: string[] = [];
  private bytes = 0;

  append(line: string): void {
    if (containsConversationBody(line) || looksLikeEnvironmentDump(line)) return;
    const redacted = redactSecrets(line);
    const size = Buffer.byteLength(redacted, 'utf8');
    if (this.bytes + size > MAX_LOG_BYTES) return;
    this.lines.push(redacted);
    this.bytes += size;
    if (this.lines.length > MAX_LOG_LINES) {
      const removed = this.lines.shift();
      if (removed !== undefined) {
        this.bytes -= Buffer.byteLength(removed, 'utf8');
      }
    }
  }

  recentLogs(): readonly string[] {
    return [...this.lines];
  }

  summary(input: {
    readonly generatedAt: string;
    readonly dependencies: DependencySnapshot;
    readonly runtime: HarnessRuntime;
  }): DiagnosticSummary {
    return {
      generatedAt: input.generatedAt,
      dependencies: input.dependencies,
      runtime: input.runtime,
      recentLogs: this.recentLogs(),
    };
  }

  report(input: {
    readonly appVersion: string;
    readonly osVersion: string;
    readonly generatedAt: string;
    readonly dependencies: DependencySnapshot;
    readonly runtime: HarnessRuntime;
  }): DiagnosticReport {
    return {
      appVersion: input.appVersion,
      osVersion: input.osVersion,
      generatedAt: input.generatedAt,
      dependencies: input.dependencies,
      runtime: input.runtime,
      recentLogs: this.recentLogs(),
    };
  }
}
