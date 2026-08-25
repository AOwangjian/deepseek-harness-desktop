import { z } from 'zod';

export const APP_NAME = 'DeepSeek Harness Desktop' as const;

const dependencyNameSchema = z.enum(['node', 'dsh']);
const installModeSchema = z.enum(['automatic', 'manual', 'later']);
const updatePolicySchema = z.enum(['notify', 'manual']);
const serviceStatusSchema = z.enum([
  'checking',
  'needs-setup',
  'starting',
  'running',
  'stopping',
  'failed',
]);

export type DependencyName = z.infer<typeof dependencyNameSchema>;
export type InstallMode = z.infer<typeof installModeSchema>;
export type UpdatePolicy = z.infer<typeof updatePolicySchema>;
export type ServiceStatus = z.infer<typeof serviceStatusSchema>;

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

export interface DependencySnapshot {
  readonly name: DependencyName;
  readonly installed: boolean;
  readonly version?: string;
  readonly executablePath?: string;
  readonly error?: string;
}

export interface HarnessRuntime {
  readonly status: ServiceStatus;
  readonly pid?: number;
  readonly port?: number;
  readonly url?: string;
  readonly error?: string;
}

export interface DiagnosticSummary {
  readonly generatedAt: string;
  readonly dependencies: readonly DependencySnapshot[];
  readonly runtime: HarnessRuntime;
  readonly recentLogs: readonly string[];
}
