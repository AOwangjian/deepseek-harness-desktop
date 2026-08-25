import { z } from 'zod';

export const APP_NAME = 'DeepSeek Harness Desktop' as const;

const dependencyNameSchema = z.enum(['node', 'dsh']);
const runtimeDependencyNameSchema = z.enum(['node', 'npm', 'dsh']);
const installModeSchema = z.enum(['automatic', 'manual', 'later']);
const updatePolicySchema = z.enum(['notify', 'manual']);

export type DependencyName = z.infer<typeof dependencyNameSchema>;
export type RuntimeDependencyName = z.infer<typeof runtimeDependencyNameSchema>;
export type InstallMode = z.infer<typeof installModeSchema>;
export type UpdatePolicy = z.infer<typeof updatePolicySchema>;

export const installRequestSchema = z
  .object({
    dependency: dependencyNameSchema,
    mode: installModeSchema,
  })
  .strict();

export type InstallRequest = Readonly<z.infer<typeof installRequestSchema>>;

export const settingsSchema = z
  .object({
    closeToTray: z.boolean(),
    autoStart: z.boolean(),
    updatePolicy: updatePolicySchema,
  })
  .strict();

export type DesktopSettings = Readonly<z.infer<typeof settingsSchema>>;

export interface DependencyCheckResult<Name extends RuntimeDependencyName = RuntimeDependencyName> {
  readonly name: Name;
  readonly present: boolean;
  readonly version?: string;
  readonly executablePath?: string;
  readonly error?: string;
}

export interface DependencySnapshot {
  readonly node: DependencyCheckResult<'node'>;
  readonly npm: DependencyCheckResult<'npm'>;
  readonly dsh: DependencyCheckResult<'dsh'>;
  readonly ready: boolean;
}

export type HarnessUrl = `http://127.0.0.1:${number}`;

export type HarnessRuntime =
  | {
      readonly status: 'checking';
    }
  | {
      readonly status: 'needs-setup';
      readonly missing: readonly DependencyName[];
    }
  | {
      readonly status: 'starting';
      readonly port: number;
    }
  | {
      readonly status: 'running';
      readonly pid: number;
      readonly port: number;
      readonly url: HarnessUrl;
    }
  | {
      readonly status: 'stopping';
      readonly pid: number;
      readonly port: number;
    }
  | {
      readonly status: 'failed';
      readonly error: string;
    };

export type ServiceStatus = HarnessRuntime['status'];

export interface DiagnosticSummary {
  readonly generatedAt: string;
  readonly dependencies: DependencySnapshot;
  readonly runtime: HarnessRuntime;
  readonly recentLogs: readonly string[];
}
