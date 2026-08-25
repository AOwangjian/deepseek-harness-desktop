import { randomBytes } from 'node:crypto';

import { execa } from 'execa';
import { createRequire } from 'node:module';

import {
  installRequestSchema,
  type InstallRequest,
} from '../../shared/contracts';

const require = createRequire(import.meta.url);
const semver = require('semver') as {
  valid(version: string): string | null;
};

const DEFAULT_CONFIRMATION_TTL_MS = 5 * 60 * 1_000;
const MAX_PROGRESS_EVENTS = 100;

export type InstallExecutable = 'winget' | 'npm';
export type InstallSource = 'Windows Package Manager' | 'npmjs.org';

export interface InstallPlan {
  readonly executable: InstallExecutable;
  readonly args: readonly string[];
  readonly source: InstallSource;
  readonly version: string;
}

export interface InstallProgressEvent {
  readonly stream: 'stdout' | 'stderr';
  readonly text: string;
}

export interface InstallExecutorOptions {
  readonly shell: false;
  readonly windowsHide: true;
  readonly reject: false;
  readonly onProgress?: (event: InstallProgressEvent) => void;
}

export interface InstallExecutionResult {
  readonly exitCode: number;
  readonly progressEvents: readonly InstallProgressEvent[];
}

export type InstallExecutor = (
  executable: InstallExecutable,
  args: readonly string[],
  options: InstallExecutorOptions,
) => Promise<{ readonly exitCode: number | null | undefined }>;

export type InstallErrorCode =
  | 'REQUEST_INVALID'
  | 'VERSION_INVALID'
  | 'PLAN_INVALID'
  | 'CONFIRMATION_INVALID'
  | 'CONFIRMATION_EXPIRED'
  | 'INSTALL_FAILED';

/** Safe, structured errors intentionally omit command output and environment data. */
export class InstallSafetyError extends Error {
  readonly code: InstallErrorCode;
  readonly exitCode?: number;

  constructor(code: InstallErrorCode, message: string, exitCode?: number) {
    super(message);
    this.name = 'InstallSafetyError';
    this.code = code;
    if (exitCode !== undefined) {
      this.exitCode = exitCode;
    }
  }
}

export class InstallExecutionError extends InstallSafetyError {
  constructor(exitCode?: number) {
    super(
      'INSTALL_FAILED',
      exitCode === undefined
        ? 'Dependency installation failed.'
        : `Dependency installation failed with exit code ${exitCode}.`,
      exitCode,
    );
    this.name = 'InstallExecutionError';
  }
}

function validVersion(version: unknown): string {
  if (typeof version !== 'string') {
    throw new InstallSafetyError('VERSION_INVALID', 'A valid version semver is required.');
  }
  const normalized = semver.valid(version);
  if (normalized === null || normalized !== version) {
    throw new InstallSafetyError('VERSION_INVALID', 'A valid version semver is required.');
  }
  return normalized;
}

function freezePlan(plan: {
  executable: InstallExecutable;
  args: readonly string[];
  source: InstallSource;
  version: string;
}): InstallPlan {
  return Object.freeze({
    executable: plan.executable,
    args: Object.freeze([...plan.args]),
    source: plan.source,
    version: plan.version,
  });
}

/** Creates the only two command lines that the installer is allowed to run. */
export function createInstallPlan(
  request: unknown,
  version: string,
): InstallPlan | null {
  const parsed = installRequestSchema.safeParse(request);
  if (!parsed.success) {
    throw new InstallSafetyError('REQUEST_INVALID', 'Unsupported install request.');
  }
  const validatedVersion = validVersion(version);
  const installRequest: InstallRequest = parsed.data;
  if (installRequest.mode !== 'automatic') {
    return null;
  }

  if (installRequest.dependency === 'node') {
    return freezePlan({
      executable: 'winget',
      args: ['install', '--id', 'OpenJS.NodeJS.LTS', '--exact', '--source', 'winget'],
      source: 'Windows Package Manager',
      version: validatedVersion,
    });
  }

  if (installRequest.dependency === 'dsh') {
    return freezePlan({
      executable: 'npm',
      args: ['install', '--global', `@deepseek-ai/dsh@${validatedVersion}`],
      source: 'npmjs.org',
      version: validatedVersion,
    });
  }

  throw new InstallSafetyError('REQUEST_INVALID', 'Unsupported install dependency.');
}

function planFingerprint(plan: InstallPlan): string {
  return JSON.stringify([
    plan.executable,
    [...plan.args],
    plan.source,
    plan.version,
  ]);
}

function assertValidPlan(plan: unknown): asserts plan is InstallPlan {
  if (typeof plan !== 'object' || plan === null || !Object.isFrozen(plan)) {
    throw new InstallSafetyError('PLAN_INVALID', 'The displayed install plan is immutable.');
  }
  const candidate = plan as Partial<InstallPlan>;
  if (!Object.isFrozen(candidate.args)) {
    throw new InstallSafetyError('PLAN_INVALID', 'The displayed install plan is immutable.');
  }
  if (
    candidate.executable !== 'winget' &&
    candidate.executable !== 'npm'
  ) {
    throw new InstallSafetyError('PLAN_INVALID', 'The install executable is not allowed.');
  }
  if (
    candidate.source !== 'Windows Package Manager' &&
    candidate.source !== 'npmjs.org'
  ) {
    throw new InstallSafetyError('PLAN_INVALID', 'The install source is not allowed.');
  }
  if (typeof candidate.version !== 'string') {
    throw new InstallSafetyError('PLAN_INVALID', 'The install version is not allowed.');
  }
  if (semver.valid(candidate.version) !== candidate.version) {
    throw new InstallSafetyError('PLAN_INVALID', 'The install version is not valid.');
  }
  if (!Array.isArray(candidate.args) || candidate.args.some((arg) => typeof arg !== 'string')) {
    throw new InstallSafetyError('PLAN_INVALID', 'The install arguments are not allowed.');
  }

  const expectedArgs =
    candidate.executable === 'winget'
      ? ['install', '--id', 'OpenJS.NodeJS.LTS', '--exact', '--source', 'winget']
      : ['install', '--global', `@deepseek-ai/dsh@${candidate.version}`];
  const expectedSource =
    candidate.executable === 'winget' ? 'Windows Package Manager' : 'npmjs.org';
  if (
    candidate.source !== expectedSource ||
    candidate.args.length !== expectedArgs.length ||
    candidate.args.some((arg, index) => arg !== expectedArgs[index])
  ) {
    throw new InstallSafetyError('PLAN_INVALID', 'The install plan is not allowlisted.');
  }
  const keys = Object.keys(plan).sort();
  if (keys.join(',') !== 'args,executable,source,version') {
    throw new InstallSafetyError('PLAN_INVALID', 'The install plan contains unexpected fields.');
  }
}

export interface ConfirmationTokenIssuerOptions {
  readonly ttlMs?: number;
  readonly now?: () => number;
}

interface TokenRecord {
  readonly fingerprint: string;
  readonly expiresAt: number;
}

/** Issues short-lived opaque tokens which can be consumed exactly once. */
export class ConfirmationTokenIssuer {
  private readonly tokens = new Map<string, TokenRecord>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: ConfirmationTokenIssuerOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_CONFIRMATION_TTL_MS;
    this.now = options.now ?? Date.now;
    if (!Number.isFinite(this.ttlMs) || this.ttlMs <= 0) {
      throw new RangeError('Confirmation token TTL must be positive.');
    }
  }

  issue(plan: InstallPlan): string {
    assertValidPlan(plan);
    const token = randomBytes(32).toString('base64url');
    this.tokens.set(token, {
      fingerprint: planFingerprint(plan),
      expiresAt: this.now() + this.ttlMs,
    });
    return token;
  }

  consume(token: string, plan: InstallPlan): void {
    assertValidPlan(plan);
    const record = this.tokens.get(token);
    if (record === undefined) {
      throw new InstallSafetyError('CONFIRMATION_INVALID', 'Confirmation is invalid or already used.');
    }
    if (record.expiresAt <= this.now()) {
      this.tokens.delete(token);
      throw new InstallSafetyError('CONFIRMATION_EXPIRED', 'Confirmation has expired.');
    }
    if (record.fingerprint !== planFingerprint(plan)) {
      throw new InstallSafetyError('CONFIRMATION_INVALID', 'Confirmation does not match the plan.');
    }
    this.tokens.delete(token);
  }
}

export function createConfirmationTokenIssuer(
  options: ConfirmationTokenIssuerOptions = {},
): ConfirmationTokenIssuer {
  return new ConfirmationTokenIssuer(options);
}

export interface ExecuteInstallPlanOptions {
  readonly onProgress?: (event: InstallProgressEvent) => void;
}

/** The production executor never invokes a shell and never returns environment data. */
export const defaultInstallExecutor: InstallExecutor = async (
  executable,
  args,
  options,
) => {
  const child = execa(executable, [...args], {
    shell: false,
    windowsHide: true,
    reject: false,
    buffer: false,
  });
  child.stdout?.on('data', (chunk: Buffer | string) => {
    options.onProgress?.({ stream: 'stdout', text: chunk.toString() });
  });
  child.stderr?.on('data', (chunk: Buffer | string) => {
    options.onProgress?.({ stream: 'stderr', text: chunk.toString() });
  });
  const result = await child;
  return { exitCode: result.exitCode };
};

export async function executeInstallPlan(
  plan: InstallPlan,
  confirmationToken: string,
  tokenIssuer: ConfirmationTokenIssuer,
  executor: InstallExecutor = defaultInstallExecutor,
  options: ExecuteInstallPlanOptions = {},
): Promise<InstallExecutionResult> {
  assertValidPlan(plan);
  tokenIssuer.consume(confirmationToken, plan);

  const progressEvents: InstallProgressEvent[] = [];
  const onProgress = (event: InstallProgressEvent): void => {
    if (
      progressEvents.length >= MAX_PROGRESS_EVENTS ||
      (event.stream !== 'stdout' && event.stream !== 'stderr') ||
      typeof event.text !== 'string'
    ) {
      return;
    }
    const safeEvent = Object.freeze({ stream: event.stream, text: event.text });
    progressEvents.push(safeEvent);
    options.onProgress?.(safeEvent);
  };

  let result: { readonly exitCode: number | null | undefined };
  try {
    result = await executor(plan.executable, plan.args, {
      shell: false,
      windowsHide: true,
      reject: false,
      onProgress,
    });
  } catch {
    throw new InstallExecutionError();
  }
  if (result.exitCode !== 0) {
    throw new InstallExecutionError(
      typeof result.exitCode === 'number' ? result.exitCode : undefined,
    );
  }
  return { exitCode: 0, progressEvents: Object.freeze([...progressEvents]) };
}
